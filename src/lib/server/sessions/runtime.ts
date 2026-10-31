/**
 * Session lifecycle. A session is its data (repo, home, transcripts) plus, while it runs,
 * a container. Stopping removes the container and keeps the data, so starting again always
 * gets the current image, accounts and settings, and Claude picks up the conversation.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';
import {
	containerLogs,
	createContainer,
	DockerError,
	exec,
	imageExists,
	inspectContainer,
	listContainers,
	pullImage,
	removeContainer,
	startContainer,
	stopContainer
} from '../docker.ts';
import { Conflict, NotFound } from '../http.ts';
import {
	deleteSession as deleteSessionRow,
	getGitIdentity,
	getGithubAccount,
	containerNamesInUse,
	getSession,
	getSettings,
	listSessions,
	setSessionContainerName,
	setSessionState
} from '../store.ts';
import { agentArgs, sessionWorkdir, slugify, type LaunchMode } from '#lib/launch.ts';
import { agentSetup, supportsRemoteControl, type AgentSetup } from '../providers.ts';
import { accountRel, backing, conversationsDir, ensureDirs, metaDir, mountSpec, sessionRel } from './storage.ts';
import { AWS_ENV, writeAwsCredentials } from './aws.ts';
import { GIT_ENV, writeGithubCredentials } from './github.ts';
import { hasConversations } from './transcripts.ts';
import type { Session, Settings } from '#lib/types.ts';

export const LABELS = {
	instance: 'orbital.instance',
	kind: 'orbital.kind',
	session: 'orbital.session',
	account: 'orbital.account'
} as const;

export const workdir = sessionWorkdir;

/**
 * Removes a container by name only if it's one of ours: names like orbital-<repo> could
 * belong to something else on the host.
 */
export async function removeOwned(name: string) {
	const info = await inspectContainer(name);
	if (info && info.Config.Labels?.[LABELS.instance] === config.instance) await removeContainer(info.Id);
}

const PREFIX = 'orbital-';

/** orbital-<repo>, or orbital-<repo>-2, -3… when that name is taken (by a session or any container). */
export async function allocateContainerName(repoDir: string): Promise<string> {
	const base = `${PREFIX}${slugify(repoDir, 48)}`;
	const taken = containerNamesInUse();
	for (let n = 1; ; n++) {
		const name = n === 1 ? base : `${base}-${n}`;
		if (!taken.has(name) && !(await inspectContainer(name))) return name;
	}
}

const pulling = new Map<string, Promise<void>>();

/** Pulls an image the first time it's needed (one pull per image at a time). */
export async function ensureImage(image: string) {
	if (await imageExists(image)) return;
	let p = pulling.get(image);
	if (!p) {
		p = pullImage(image).finally(() => pulling.delete(image));
		pulling.set(image, p);
	}
	await p;
}

/** KEY=value lines from Settings → Extra environment. */
export function parseEnvLines(text: string): string[] {
	return text
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#') && /^[A-Za-z_][A-Za-z0-9_]*=/.test(l));
}

// Without a GitHub account git has no identity, and every commit would fail.
const FALLBACK_IDENTITY = { name: 'Claude', email: 'noreply@anthropic.com' };

function githubEnv(accountId: string | null): string[] {
	const account = accountId && getGithubAccount(accountId) ? accountId : null;
	const who = (account && getGitIdentity(account)) || FALLBACK_IDENTITY;
	return [
		// The token itself is in files kept current while the session runs (see ./github.ts).
		...GIT_ENV,
		...AWS_ENV,
		`GIT_AUTHOR_NAME=${who.name}`,
		`GIT_AUTHOR_EMAIL=${who.email}`,
		`GIT_COMMITTER_NAME=${who.name}`,
		`GIT_COMMITTER_EMAIL=${who.email}`
	];
}

function writeLaunch(s: Session, agent: AgentSetup, launch: LaunchMode) {
	const opts = { name: s.name, model: s.model, permissionMode: s.permissionMode, remoteControl: s.remoteControl && supportsRemoteControl(agent.account) };
	const args = agentArgs(agent.agent, opts, launch);
	writeFileSync(join(metaDir(s.id), 'launch.json'), JSON.stringify({ agent: agent.agent, args, launch: launch.mode, at: new Date().toISOString() }, null, 2));
}

/**
 * Without an explicit choice, pick up the newest conversation if there is one. Codex and
 * Gemini keep theirs by working directory (unique per session) and start fresh when there
 * is nothing to resume, so any earlier launch is enough.
 */
function defaultLaunch(s: Session): LaunchMode {
	const before = s.agent === 'claude' ? hasConversations(s) : existsSync(join(metaDir(s.id), 'launch.json'));
	return before ? { mode: 'continue' } : { mode: 'new' };
}

function containerSpec(s: Session, settings: Settings, agent: AgentSetup, mounts: Record<string, unknown>[]) {
	const env = [
		`HOME=/session/home`,
		// Transcripts land in accounts/<account>/projects/<session id>, whatever the folder.
		`CLAUDE_CODE_PROJECT_DIR_NAME=${s.id}`,
		`CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX=orbital`,
		`ORB_SESSION_ID=${s.id}`,
		`ORB_REPO_URL=${s.repoUrl}`,
		`ORB_REPO_DIR=${workdir(s)}`,
		...(s.baseBranch ? [`ORB_BASE_BRANCH=${s.baseBranch}`] : []),
		...(s.newBranch ? [`ORB_NEW_BRANCH=${s.newBranch}`] : []),
		...(s.checkoutPr ? [`ORB_PR_NUMBER=${s.checkoutPr}`] : []),
		...(s.permissionMode === 'bypassPermissions' ? ['ORB_BYPASS_PERMISSIONS=1'] : []),
		...parseEnvLines(settings.extraEnv),
		...agent.env,
		...githubEnv(s.githubAccountId)
	];
	return {
		Image: agent.image,
		Hostname: s.containerName,
		Env: env,
		WorkingDir: workdir(s),
		Labels: {
			[LABELS.instance]: config.instance,
			[LABELS.kind]: 'session',
			[LABELS.session]: s.id,
			[LABELS.account]: s.accountId
		},
		HostConfig: {
			Mounts: mounts,
			NetworkMode: settings.network || undefined,
			Memory: settings.memoryMb > 0 ? Math.round(settings.memoryMb * 1024 * 1024) : undefined,
			NanoCpus: settings.cpus > 0 ? Math.round(settings.cpus * 1e9) : undefined,
			RestartPolicy: { Name: 'no' },
			ExtraHosts: ['host.docker.internal:host-gateway']
		}
	};
}

const inFlight = new Set<string>();

export async function startSession(id: string, launch?: LaunchMode): Promise<Session> {
	const s = getSession(id);
	if (!s) throw new NotFound('Session not found');
	if (inFlight.has(id)) throw new Conflict('This session is already starting');
	if (s.status === 'running' && s.containerId && (await inspectContainer(s.containerId))?.State.Running) {
		throw new Conflict('This session is already running');
	}
	inFlight.add(id);
	setSessionState(id, { status: 'starting', error: null });
	try {
		const settings = getSettings();
		const b = await backing();
		ensureDirs(accountRel(s.accountId), `${sessionRel(id)}/home`, `${sessionRel(id)}/repo`, `${sessionRel(id)}/.orb`);
		writeGithubCredentials(s);
		await writeAwsCredentials(s);
		const agent = agentSetup(s.accountId); // fails early if the account is gone
		await ensureImage(agent.image);
		writeLaunch(s, agent, launch ?? defaultLaunch(s));
		await removeOwned(s.containerName);
		// Sessions from before the rename (claude-<repo>, ccm-…) take an orbital- name at their next start.
		if (!s.containerName.startsWith(PREFIX)) {
			s.containerName = await allocateContainerName(s.repoDir);
			setSessionContainerName(id, s.containerName);
		}
		const name = s.containerName;
		const mounts = [
			mountSpec(b, accountRel(s.accountId), agent.mount),
			mountSpec(b, sessionRel(id), '/session'),
			mountSpec(b, `${sessionRel(id)}/repo`, workdir(s))
		];
		const containerId = await createContainer(name, containerSpec(s, settings, agent, mounts));
		await startContainer(containerId);
		setSessionState(id, { status: 'running', containerId, error: null, started: true });
	} catch (err) {
		setSessionState(id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
		throw err;
	} finally {
		inFlight.delete(id);
	}
	return getSession(id)!;
}

export async function stopSession(id: string): Promise<Session> {
	const s = getSession(id);
	if (!s) throw new NotFound('Session not found');
	if (s.containerId) {
		await stopContainer(s.containerId, 10);
		await removeContainer(s.containerId);
	}
	await removeOwned(s.containerName);
	writeGithubCredentials(s, { remove: true });
	await writeAwsCredentials(s, { remove: true });
	setSessionState(id, { status: 'stopped', containerId: null, error: null, stopped: true });
	return getSession(id)!;
}

/** The running container of a session, or a clear error. */
export async function runningContainer(id: string): Promise<{ session: Session; container: string }> {
	const s = getSession(id);
	if (!s) throw new NotFound('Session not found');
	const info = s.containerId ? await inspectContainer(s.containerId) : null;
	if (!info?.State.Running) throw new Conflict('The session is not running. Start it first.');
	return { session: s, container: info.Id };
}

/** Restarts the agent inside a running session (to resume another conversation, or after it exited). */
export async function relaunchAgent(id: string, launch?: LaunchMode): Promise<Session> {
	const { session, container } = await runningContainer(id);
	const agent = agentSetup(session.accountId);
	const info = await inspectContainer(container);
	// The container's environment and image belong to the account it started with.
	if (info?.Config.Labels?.[LABELS.account] !== session.accountId) {
		throw new Conflict('The session changed accounts since it started. Stop and start it to switch.');
	}
	writeLaunch(session, agent, launch ?? defaultLaunch(session));
	writeGithubCredentials(session);
	await writeAwsCredentials(session);
	const r = await exec(container, ['tmux', 'respawn-pane', '-k', '-t', 'main', 'orb-launch'], { user: 'node' });
	if (r.exitCode !== 0) throw new DockerError(r.stderr.trim() || 'Could not restart the agent');
	return session;
}

/** Types into the session's terminal, as if from the keyboard. */
export async function sendToSession(id: string, input: { text?: string; keys?: string[]; enter?: boolean }) {
	const { container } = await runningContainer(id);
	const cmds: string[][] = [];
	// "--": a message starting with "-" would otherwise be read as a send-keys flag.
	if (input.text) cmds.push(['tmux', 'send-keys', '-t', 'main', '-l', '--', input.text]);
	for (const k of input.keys ?? []) cmds.push(['tmux', 'send-keys', '-t', 'main', k]);
	if (input.enter) cmds.push(['tmux', 'send-keys', '-t', 'main', 'Enter']);
	for (const cmd of cmds) await exec(container, cmd, { user: 'node' });
}

export async function deleteSession(id: string) {
	const s = getSession(id);
	if (!s) throw new NotFound('Session not found');
	if (s.containerId) await removeContainer(s.containerId);
	await removeOwned(s.containerName);
	rmSync(join(config.sessionsDir, sessionRel(id)), { recursive: true, force: true });
	rmSync(conversationsDir(s.accountId, id), { recursive: true, force: true });
	deleteSessionRow(id);
}

/**
 * Brings the store in line with Docker: sessions whose container went away are stopped,
 * containers that exited (Claude and the fallback shell both ended) are cleaned up.
 */
export async function reconcile() {
	const containers = await listContainers([`${LABELS.instance}=${config.instance}`, `${LABELS.kind}=session`]);
	const bySession = new Map(containers.map((c) => [c.Labels[LABELS.session], c]));
	for (const s of listSessions()) {
		if (inFlight.has(s.id)) continue;
		const c = bySession.get(s.id);
		if (c?.State === 'running') {
			if (s.status !== 'running' || s.containerId !== c.Id) setSessionState(s.id, { status: 'running', containerId: c.Id });
			continue;
		}
		// The listing can be stale: a start may have finished since. Look again before acting.
		const id = c?.Id ?? s.containerId;
		const info = id ? await inspectContainer(id) : null;
		if (info?.State.Running) {
			if (s.status !== 'running' || s.containerId !== info.Id) setSessionState(s.id, { status: 'running', containerId: info.Id });
			continue;
		}
		if (info?.State.Status === 'created') continue;
		if (info) {
			// Exited by itself: keep the reason when it failed, then clean up.
			const code = info.State.ExitCode ?? 0;
			const logs = code !== 0 ? await containerLogs(info.Id, 20).catch(() => '') : '';
			await removeContainer(info.Id);
			writeGithubCredentials(s, { remove: true });
			await writeAwsCredentials(s, { remove: true });
			setSessionState(s.id, {
				status: code === 0 ? 'stopped' : 'error',
				containerId: null,
				error: code === 0 ? null : logs.split('\n').slice(-6).join('\n') || `Container exited with status ${code}`,
				stopped: true
			});
		} else if (s.status === 'running' || s.status === 'starting') {
			writeGithubCredentials(s, { remove: true });
			await writeAwsCredentials(s, { remove: true });
			setSessionState(s.id, { status: 'stopped', containerId: null, stopped: true });
		}
	}
}
