import type { Agent, PermissionMode } from './types.ts';

/**
 * Normalizes what someone typed as a repository: `owner/name`, a GitHub https or ssh URL,
 * or any other https git URL. GitHub repos are cloned over https (the token authenticates).
 */
export function parseRepo(input: string): { url: string; fullName: string | null; dir: string } | null {
	const s = input.trim();
	if (!s) return null;
	let m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/.exec(s);
	if (!m) m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(s);
	if (!m) m = /^(?:ssh:\/\/)?git@github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/i.exec(s);
	if (m) {
		const fullName = `${m[1]}/${m[2]}`;
		return { url: `https://github.com/${fullName}.git`, fullName, dir: repoDirName(m[2]) };
	}
	let u: URL;
	try {
		u = new URL(s);
	} catch {
		return null;
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
	// Credentials in the URL would end up in the container's environment and the UI.
	if (u.username || u.password) return null;
	const last = u.pathname.replace(/\/+$/, '').split('/').pop() ?? '';
	const dir = repoDirName(last.replace(/\.git$/, ''));
	if (!dir) return null;
	return { url: u.toString(), fullName: null, dir };
}

/** What a session works on, for display: owner/name, the git URL, or that it has no repo. */
export function repoLabel(s: { repoUrl: string; repoFullName: string | null }): string {
	return s.repoFullName ?? (s.repoUrl || 'No repo');
}

/** A safe folder name under /workspace. */
export function repoDirName(name: string): string {
	return name
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^[.-]+/, '')
		.slice(0, 80);
}

/** Lowercase, dash-separated, for container names. */
export function slugify(name: string, max = 40): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, max)
			.replace(/-+$/, '') || 'session'
	);
}

/** A light check against git's ref-name rules (enough to reject typos and injection). */
export function isValidBranch(name: string): boolean {
	if (!name || name.length > 200) return false;
	if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)) return false;
	if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
	if (name.includes('..') || name.includes('//') || name.includes('@{')) return false;
	return true;
}

export type LaunchMode = { mode: 'new'; prompt?: string | null } | { mode: 'continue' } | { mode: 'resume'; conversationId: string };

export interface LaunchOptions {
	name: string;
	model: string | null;
	permissionMode: PermissionMode;
	/** Only honored for claude.ai subscription logins; tokens and API keys can't use it. */
	remoteControl: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Claude Code's command-line arguments for one launch of a session. */
export function claudeArgs(opts: LaunchOptions, launch: LaunchMode): string[] {
	const args = ['--name', opts.name];
	if (opts.model) args.push('--model', opts.model);
	if (opts.permissionMode !== 'default') args.push('--permission-mode', opts.permissionMode);
	if (launch.mode === 'continue') args.push('--continue');
	if (launch.mode === 'resume') {
		if (!UUID.test(launch.conversationId)) throw new Error('Invalid conversation id');
		args.push('--resume', launch.conversationId);
	}
	// --remote-control takes an optional name. Always pass one, so a prompt that follows
	// is never read as the name.
	if (opts.remoteControl) args.push('--remote-control', opts.name);
	if (launch.mode === 'new' && launch.prompt?.trim()) {
		const p = launch.prompt.trim();
		// A prompt starting with "-" would be parsed as a flag.
		args.push(p.startsWith('-') ? ` ${p}` : p);
	}
	return args;
}

/**
 * Codex CLI's arguments. Its own sandbox (bubblewrap) can't create namespaces inside an
 * unprivileged container, so Codex runs with full access to the container, which is the
 * sandbox, and asks before commands unless permissions are bypassed.
 */
export function codexArgs(opts: LaunchOptions, launch: LaunchMode): string[] {
	const flags = ['--no-daemon'];
	if (opts.permissionMode === 'bypassPermissions') flags.push('--dangerously-bypass-approvals-and-sandbox');
	else flags.push('-s', 'danger-full-access', '-a', 'on-request');
	if (opts.model) flags.push('-m', opts.model);
	if (launch.mode === 'continue') return ['resume', '--last', ...flags];
	if (launch.mode === 'resume') {
		if (!UUID.test(launch.conversationId)) throw new Error('Invalid conversation id');
		return ['resume', launch.conversationId, ...flags];
	}
	const p = launch.prompt?.trim();
	return p ? [...flags, p.startsWith('-') ? ` ${p}` : p] : flags;
}

const GEMINI_APPROVAL: Record<PermissionMode, string> = {
	default: 'default',
	acceptEdits: 'auto_edit',
	plan: 'plan',
	auto: 'auto_edit',
	bypassPermissions: 'yolo'
};

/** Gemini CLI's arguments. The session's folder is trusted for the session (--skip-trust). */
export function geminiArgs(opts: LaunchOptions, launch: LaunchMode): string[] {
	const args = ['--skip-trust', '--approval-mode', GEMINI_APPROVAL[opts.permissionMode]];
	if (opts.model) args.push('-m', opts.model);
	if (launch.mode === 'continue') args.push('--resume', 'latest');
	if (launch.mode === 'resume') args.push('--resume', launch.conversationId);
	if (launch.mode === 'new' && launch.prompt?.trim()) args.push('--prompt-interactive', launch.prompt.trim());
	return args;
}

export function agentArgs(agent: Agent, opts: LaunchOptions, launch: LaunchMode): string[] {
	if (agent === 'codex') return codexArgs(opts, launch);
	if (agent === 'gemini') return geminiArgs(opts, launch);
	return claudeArgs(opts, launch);
}

/**
 * Where a session's repository is inside its container. Codex and Gemini file conversations
 * by working directory, so theirs is unique per session; Claude's go by session id already.
 */
export function sessionWorkdir(s: { id: string; repoDir: string; agent: Agent }): string {
	return s.agent === 'claude' ? `/workspace/${s.repoDir}` : `/workspace/${s.id.slice(0, 8)}/${s.repoDir}`;
}
