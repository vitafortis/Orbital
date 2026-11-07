import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { conversationInfo, excerpt, readTurns, summarizeTranscript } from '#lib/transcript.ts';
import { conversationsDir } from './storage.ts';
import type { Conversation, ReadTurn, Session, TranscriptSummary } from '#lib/types.ts';

// Long sessions grow large transcripts; the overview only needs the recent part.
const MAX_READ = 24 * 1024 * 1024;

type FileInfo = { path: string; id: string; mtimeMs: number; size: number };

function transcriptFiles(s: Pick<Session, 'id' | 'accountId'>): FileInfo[] {
	const dir = conversationsDir(s.accountId, s.id);
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const out: FileInfo[] = [];
	for (const n of names) {
		if (!n.endsWith('.jsonl')) continue;
		try {
			const st = statSync(join(dir, n));
			if (st.isFile() && st.size > 0) out.push({ path: join(dir, n), id: basename(n, '.jsonl'), mtimeMs: st.mtimeMs, size: st.size });
		} catch {}
	}
	return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Reads a transcript, or its last MAX_READ bytes (starting at a line boundary). */
function readTail(f: FileInfo, max = MAX_READ): string {
	const len = Math.min(f.size, max);
	const buf = Buffer.alloc(len);
	const fd = openSync(f.path, 'r');
	try {
		readSync(fd, buf, 0, len, f.size - len);
	} finally {
		closeSync(fd);
	}
	const text = buf.toString('utf8');
	return len < f.size ? text.slice(text.indexOf('\n') + 1) : text;
}

export function hasConversations(s: Pick<Session, 'id' | 'accountId'>): boolean {
	return transcriptFiles(s).length > 0;
}

const cache = new Map<string, { mtimeMs: number; size: number; summary: TranscriptSummary }>();

/** A summary of the session's newest conversation, re-read only when the file changed. */
export function latestSummary(s: Pick<Session, 'id' | 'accountId'>): TranscriptSummary | null {
	const f = transcriptFiles(s)[0];
	if (!f) return null;
	const hit = cache.get(f.path);
	if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) return hit.summary;
	const summary = summarizeTranscript(readTail(f), f.id, new Date(f.mtimeMs).toISOString());
	cache.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, summary });
	return summary;
}

const infoCache = new Map<string, { mtimeMs: number; size: number; info: ReturnType<typeof conversationInfo> }>();

/** The session's conversations, newest first. Only files that changed since the last call are read again. */
export function listConversations(s: Pick<Session, 'id' | 'accountId'>): Conversation[] {
	return transcriptFiles(s)
		.slice(0, 50)
		.map((f) => {
			let hit = infoCache.get(f.path);
			if (!hit || hit.mtimeMs !== f.mtimeMs || hit.size !== f.size) {
				hit = { mtimeMs: f.mtimeMs, size: f.size, info: conversationInfo(readTail(f, 4 * 1024 * 1024)) };
				infoCache.set(f.path, hit);
			}
			return { id: f.id, ...hit.info, updatedAt: new Date(f.mtimeMs).toISOString(), bytes: f.size };
		})
		.filter((c) => c.messages > 0);
}

/** Recent turns of the newest conversation as plain text (for an AI summary). */
export function latestExcerpt(s: Pick<Session, 'id' | 'accountId'>): string | null {
	const f = transcriptFiles(s)[0];
	return f ? excerpt(readTail(f)) : null;
}

const turnsCache = new Map<string, { mtimeMs: number; size: number; turns: ReadTurn[] }>();

/** A conversation's recent turns for the Read tab: the newest one, or the one asked for. */
export function conversationTurns(s: Pick<Session, 'id' | 'accountId'>, conversationId?: string | null): { conversationId: string; updatedAt: string; turns: ReadTurn[] } | null {
	const files = transcriptFiles(s);
	const f = conversationId ? files.find((x) => x.id === conversationId) : files[0];
	if (!f) return null;
	let hit = turnsCache.get(f.path);
	if (!hit || hit.mtimeMs !== f.mtimeMs || hit.size !== f.size) {
		hit = { mtimeMs: f.mtimeMs, size: f.size, turns: readTurns(readTail(f)) };
		turnsCache.set(f.path, hit);
	}
	return { conversationId: f.id, updatedAt: new Date(f.mtimeMs).toISOString(), turns: hit.turns };
}
