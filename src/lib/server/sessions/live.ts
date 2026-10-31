/**
 * Keeps a live view of every session for the overview: what Claude is doing (read off the
 * terminal), the last screen lines, git status, the Remote Control link, and a summary of
 * the newest conversation. Polls fast while someone is watching, slowly otherwise.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from '../docker.ts';
import { getSession, listSessions, setSessionRcUrl } from '../store.ts';
import { extractLinks, findRcUrl, paneState, parseProbe } from '#lib/pane.ts';
import { checkPr } from './prs.ts';
import { reconcile, runningContainer } from './runtime.ts';
import { metaDir } from './storage.ts';
import { latestExcerpt, latestSummary } from './transcripts.ts';
import { renewAwsCredentials, sessionAws } from './aws.ts';
import { sweepLogins } from '../accounts.ts';
import type { GitState, Session, SessionLive } from '#lib/types.ts';

const FAST_MS = 2500;
const lastSummary = new Map<string, NonNullable<SessionLive['summary']>>();
const SLOW_MS = 15_000;
// git status on every fifth probe; it's the slow part on big repos.
const GIT_EVERY = 5;

const live = new Map<string, SessionLive>();
const gitCache = new Map<string, GitState | null>();
const listeners = new Set<(list: SessionLive[]) => void>();
let tick = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

function readAiSummary(id: string): SessionLive['aiSummary'] {
	try {
		return JSON.parse(readFileSync(join(metaDir(id), 'ai-summary.json'), 'utf8'));
	} catch {
		return null;
	}
}

async function probe(s: Session, withGit: boolean): Promise<Pick<SessionLive, 'state' | 'tail' | 'rcUrl' | 'links' | 'git'>> {
	if (s.status !== 'running' || !s.containerId) {
		return { state: s.status === 'starting' ? 'starting' : 'unknown', tail: live.get(s.id)?.tail ?? [], rcUrl: s.rcUrl, links: [], git: gitCache.get(s.id) ?? null };
	}
	try {
		const r = await exec(s.containerId, ['orb-status', ...(withGit ? ['--git'] : [])], { user: 'node', timeoutMs: 8000 });
		const p = parseProbe(r.stdout);
		if (p.git || withGit) gitCache.set(s.id, p.git);
		const rcUrl = findRcUrl(p.lines) ?? s.rcUrl;
		if (rcUrl !== s.rcUrl) setSessionRcUrl(s.id, rcUrl);
		return { state: paneState(p.command, p.lines, s.agent), tail: p.lines.slice(-40), rcUrl, links: extractLinks(p.lines), git: gitCache.get(s.id) ?? null };
	} catch {
		return { state: 'unknown', tail: live.get(s.id)?.tail ?? [], rcUrl: s.rcUrl, links: live.get(s.id)?.links ?? [], git: gitCache.get(s.id) ?? null };
	}
}

async function pollOnce() {
	await reconcile().catch((err) => console.error('[orbital] reconcile failed:', err instanceof Error ? err.message : err));
	if (tick % 30 === 0) await sweepLogins().catch(() => {});
	await renewAwsCredentials().catch(() => {});
	const withGit = tick++ % GIT_EVERY === 0;
	const sessions = listSessions();
	const results = await Promise.all(
		sessions.map(async (s): Promise<SessionLive> => {
			const p = await probe(s, withGit);
			void checkPr(s, p.git);
			let summary = null;
			try {
				// Transcripts are Claude Code's; Codex and Gemini show their state on screen.
				if (s.agent === 'claude') summary = latestSummary(s);
				if (summary) lastSummary.set(s.id, summary);
			} catch {
				// Read while Claude was writing it: keep the last good one, or the panel jumps.
				summary = lastSummary.get(s.id) ?? null;
			}
			return { id: s.id, status: s.status, ...p, summary, aiSummary: readAiSummary(s.id), aws: sessionAws(s.id), at: new Date().toISOString() };
		})
	);
	live.clear();
	for (const r of results) live.set(r.id, r);
	const list = [...live.values()];
	for (const fn of listeners) fn(list);
}

async function loop() {
	if (running) return;
	running = true;
	try {
		await pollOnce();
	} finally {
		running = false;
		timer = setTimeout(loop, listeners.size ? FAST_MS : SLOW_MS);
		timer.unref?.();
	}
}

export function startLive() {
	if (timer === undefined) void loop();
}

/** Polls right away (after starting, stopping…), instead of waiting for the next tick. */
export function pokeLive() {
	if (timer) clearTimeout(timer);
	void loop();
}

export function liveSnapshot(): SessionLive[] {
	return [...live.values()];
}

export function subscribeLive(fn: (list: SessionLive[]) => void): () => void {
	const wasIdle = listeners.size === 0;
	listeners.add(fn);
	fn(liveSnapshot());
	if (wasIdle) pokeLive();
	return () => listeners.delete(fn);
}

const SUMMARY_PROMPT =
	'Below is the recent part of a Claude Code session transcript. In at most 3 short sentences, say what the ' +
	'session is working on, where it stands now, and whether it is waiting for the user. Plain text, no preamble, no tools.';

/** Asks Claude (the session's own account, a small model) for a plain-language summary. */
export async function aiSummary(id: string): Promise<NonNullable<SessionLive['aiSummary']>> {
	const { session, container } = await runningContainer(id);
	const text = latestExcerpt(session);
	if (!text) throw new Error('There is no conversation to summarize yet.');
	writeFileSync(join(metaDir(id), 'summary-input.txt'), text);
	const r = await exec(
		container,
		[
			'bash',
			'-c',
			'cd /tmp && claude -p --model haiku --no-session-persistence --max-turns 1 "$ORB_SUMMARY_PROMPT" < /session/.orb/summary-input.txt'
		],
		{ user: 'node', env: [`ORB_SUMMARY_PROMPT=${SUMMARY_PROMPT}`], timeoutMs: 120_000 }
	);
	const out = r.stdout.trim();
	if (r.exitCode !== 0 || !out) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') || 'Claude did not answer');
	const result = { text: out, at: new Date().toISOString() };
	writeFileSync(join(metaDir(id), 'ai-summary.json'), JSON.stringify(result));
	const cur = live.get(id);
	if (cur && getSession(id)) live.set(id, { ...cur, aiSummary: result });
	return result;
}
