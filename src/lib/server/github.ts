/**
 * GitHub accounts: a personal access token (classic or fine-grained), or "Sign in with
 * GitHub" through the device flow when ORB_GITHUB_CLIENT_ID names an OAuth app.
 * Tokens list repositories and are handed to session containers for clone and push.
 */
import { randomToken } from './crypto.ts';
import { config } from './config.ts';
import { BadRequest } from './http.ts';
import { getGithubToken, getSettings, listGithubAccounts, setGithubOrgs, upsertGithubAccount, type GithubAccountInput } from './store.ts';
import type { GithubAccount, GithubPull, GithubRepo, SessionPr, TokenAccess } from '#lib/types.ts';
import { refreshGithubCredentials } from './sessions/github.ts';

const API = 'https://api.github.com';

/** A GitHub REST call, with the account's token or anonymously (public repos). */
async function ghFetch(token: string | undefined, path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
	return fetch(`${API}${path}`, {
		method: init.method,
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
		headers: {
			accept: 'application/vnd.github+json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
			'x-github-api-version': '2022-11-28',
			'user-agent': 'orbital'
		},
		signal: AbortSignal.timeout(15_000)
	}).catch((err: unknown) => {
		const why = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
		throw new BadRequest(`Couldn't reach GitHub (${why}). Check this server's network or proxy.`);
	});
}

async function gh<T>(token: string | undefined, path: string): Promise<{ data: T; headers: Headers }> {
	const res = await ghFetch(token, path);
	if (res.status === 401) throw new BadRequest('GitHub rejected the token (expired or revoked?)');
	if (res.status === 404 && !token) throw new BadRequest('Repository not found (private? pick a GitHub account)');
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { message?: string };
		throw new BadRequest(`GitHub: ${body.message ?? res.statusText}`);
	}
	return { data: (await res.json()) as T, headers: res.headers };
}

const FULL_NAME = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const tokenOf = (account: GithubAccount | null) => (account ? getGithubToken(account.id) : undefined);

type GhUser = { id: number; login: string; name: string | null; avatar_url: string };
type GhRepo = {
	full_name: string;
	name: string;
	owner: { login: string };
	private: boolean;
	permissions?: Partial<Record<'admin' | 'maintain' | 'push' | 'triage' | 'pull', boolean>>;
	default_branch: string;
	description: string | null;
	pushed_at: string | null;
	html_url: string;
};

async function orgsOf(token: string): Promise<string[]> {
	try {
		const { data } = await gh<{ login: string }[]>(token, '/user/orgs?per_page=100');
		return data.map((o) => o.login);
	} catch {
		// Fine-grained tokens without org access can't list orgs; repos still work.
		return [];
	}
}

/** Checks a token and saves (or refreshes) the account it belongs to. */
export async function addGithubToken(token: string, kind: GithubAccount['kind'], opts: { label?: string | null; replace?: string } = {}): Promise<GithubAccount> {
	const t = token.trim();
	if (!t) throw new BadRequest('Paste a token');
	const { data: user, headers } = await gh<GhUser>(t, '/user');
	const input: GithubAccountInput = {
		login: user.login,
		name: user.name,
		avatarUrl: user.avatar_url,
		kind,
		token: t,
		scopes: headers.get('x-oauth-scopes'),
		orgs: await orgsOf(t),
		// Commits from sessions use the account's GitHub noreply address.
		gitName: user.name || user.login,
		gitEmail: `${user.id}+${user.login}@users.noreply.github.com`
	};
	const account = upsertGithubAccount(input, opts);
	repoCache.delete(account.id);
	refreshGithubCredentials(account.id);
	return account;
}

export async function refreshOrgs(account: GithubAccount): Promise<string[]> {
	const token = getGithubToken(account.id);
	if (!token) return [];
	const orgs = await orgsOf(token);
	setGithubOrgs(account.id, orgs);
	return orgs;
}

const toRepo = (r: GhRepo): GithubRepo => ({
	fullName: r.full_name,
	owner: r.owner.login,
	name: r.name,
	private: r.private,
	defaultBranch: r.default_branch,
	description: r.description,
	pushedAt: r.pushed_at,
	url: r.html_url
});

const repoCache = new Map<string, { at: number; list: RepoList }>();

/** A token's repositories, and why some may be missing from them. */
export type RepoList = { repos: GithubRepo[]; notice: string | null };

// Organizations with SAML single sign-on hide their repos from a token until it's authorized.
const SSO_NOTICE =
	'Some of your organizations use single sign-on and leave their repos out until this token is authorized for them: on GitHub, Settings → Developer settings → Personal access tokens → Configure SSO.';

/** An owner's repos as the token sees them, private ones included; an org first, else a user. */
export async function ownerRepos(account: GithubAccount, owner: string): Promise<GithubRepo[]> {
	if (!/^[A-Za-z0-9-]+$/.test(owner)) throw new BadRequest('Invalid owner');
	const token = getGithubToken(account.id);
	const repos: GithubRepo[] = [];
	const base = owner.toLowerCase() === account.login.toLowerCase() ? null : `/orgs/${owner}/repos?type=all&sort=pushed`;
	if (!base) return (await listRepos(account)).repos.filter((r) => r.owner.toLowerCase() === owner.toLowerCase());
	for (let page = 1; page <= 10; page++) {
		const res = await ghFetch(token, `${base}&per_page=100&page=${page}`);
		if (res.status === 404) return (await gh<GhRepo[]>(token, `/users/${owner}/repos?type=all&sort=pushed&per_page=100`)).data.map(toRepo);
		if (!res.ok) throw new BadRequest(`GitHub: ${((await res.json().catch(() => ({}))) as { message?: string }).message ?? res.statusText}`);
		const data = (await res.json()) as GhRepo[];
		repos.push(...data.map(toRepo));
		if (data.length < 100) break;
	}
	return repos;
}

/**
 * Creates a repository for a new session, under the token's user or one of its organizations,
 * with a first commit (a README) so there's a default branch to clone and branch from.
 */
export async function createRepo(account: GithubAccount, opts: { owner: string; name: string; private: boolean; description?: string | null }): Promise<GithubRepo> {
	if (!/^[A-Za-z0-9-]+$/.test(opts.owner)) throw new BadRequest('Invalid owner');
	if (!/^[A-Za-z0-9._-]{1,100}$/.test(opts.name) || /^\.+$/.test(opts.name)) throw new BadRequest('A repo name is letters, digits, ".", "-" and "_"');
	const token = getGithubToken(account.id);
	const mine = opts.owner.toLowerCase() === account.login.toLowerCase();
	const res = await ghFetch(token, mine ? '/user/repos' : `/orgs/${opts.owner}/repos`, {
		method: 'POST',
		body: { name: opts.name, private: opts.private, description: opts.description || undefined, auto_init: true }
	});
	if (!res.ok) {
		const b = (await res.json().catch(() => ({}))) as { message?: string; errors?: { message?: string }[] };
		const why = b.errors?.map((e) => e.message).find(Boolean) ?? b.message ?? res.statusText;
		const hint =
			res.status === 403 || res.status === 404
				? ' A classic token needs the repo scope; a fine-grained one needs Administration (read and write) on the owner, and creating in an organization needs its permission to create repos.'
				: '';
		throw new BadRequest(`GitHub couldn't create ${opts.owner}/${opts.name}: ${why}.${hint}`);
	}
	const repo = toRepo((await res.json()) as GhRepo);
	repoCache.delete(account.id);
	return repo;
}

/**
 * Every repo the token can see, most recently pushed first: the user's list, plus each
 * organization's own list. A token owned by an organization (a fine-grained one) doesn't
 * always bring that organization's private repos into the user's list.
 */
export async function listRepos(account: GithubAccount, refresh = false): Promise<RepoList> {
	const hit = repoCache.get(account.id);
	if (!refresh && hit && Date.now() - hit.at < 2 * 60_000) return hit.list;
	const token = getGithubToken(account.id);
	if (!token) return { repos: [], notice: null };
	const byName = new Map<string, GithubRepo>();
	let notice: string | null = null;
	for (let page = 1; page <= 10; page++) {
		const { data, headers } = await gh<GhRepo[]>(token, `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`);
		if (headers.get('x-github-sso')?.startsWith('partial-results')) notice = SSO_NOTICE;
		for (const r of data) byName.set(r.full_name, toRepo(r));
		if (data.length < 100) break;
	}
	const orgs = new Set([...account.orgs, ...[...byName.values()].map((r) => r.owner)]);
	orgs.delete(account.login);
	await Promise.all(
		[...orgs].slice(0, 20).map(async (org) => {
			const res = await ghFetch(token, `/orgs/${org}/repos?type=all&sort=pushed&per_page=100`).catch(() => null);
			if (!res?.ok) return; // a user, not an org, or no access: the user's list has what there is
			const data = (await res.json().catch(() => [])) as GhRepo[];
			if (Array.isArray(data)) for (const r of data) if (!byName.has(r.full_name)) byName.set(r.full_name, toRepo(r));
		})
	);
	const repos = [...byName.values()].sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
	const list = { repos, notice };
	repoCache.set(account.id, { at: Date.now(), list });
	return list;
}

/**
 * Repos whose name matches, among the owners the token knows (its user, its orgs, the owners
 * in its list): GitHub's search finds those past the first thousand of the list too.
 */
export async function searchRepos(account: GithubAccount, query: string): Promise<GithubRepo[]> {
	const words = query.replace(/[^\w.-]+/g, ' ').trim();
	if (!words) return [];
	const known = repoCache.get(account.id)?.list.repos.map((r) => r.owner) ?? [];
	const owners = [...new Set([account.login, ...account.orgs, ...known])].slice(0, 20);
	const q = `${words} in:name ${owners.map((o) => `user:${o}`).join(' ')}`;
	const { data } = await gh<{ items: GhRepo[] }>(getGithubToken(account.id), `/search/repositories?q=${encodeURIComponent(q)}&per_page=30&sort=updated`);
	return data.items.map(toRepo);
}

/** One repo by owner/name, or a plain account of why this token can't see it. */
export async function lookupRepo(account: GithubAccount, fullName: string): Promise<GithubRepo> {
	if (!FULL_NAME.test(fullName)) throw new BadRequest('Enter the repository as owner/name');
	const res = await ghFetch(getGithubToken(account.id), `/repos/${fullName}`);
	if (res.ok) return toRepo((await res.json()) as GhRepo);
	throw new BadRequest(await missReason(account, fullName, res));
}

/** Why GitHub didn't return the repository for this token, from what it answered. */
async function missReason(account: GithubAccount, fullName: string, res: Response): Promise<string> {
	if (res.status === 401) return 'GitHub rejected the token (expired or revoked?)';
	const owner = fullName.split('/')[0];
	const sso = res.headers.get('x-github-sso');
	const ssoUrl = sso?.match(/url=(\S+)/)?.[1];
	if (ssoUrl) return `${owner} uses single sign-on: authorize this token for it at ${ssoUrl}, then try again.`;
	const message = ((await res.json().catch(() => ({}))) as { message?: string }).message;
	if (res.status !== 404) return `GitHub: ${message ?? res.statusText}`;
	// Facts only: what GitHub returned, not a guess at the token's settings.
	const listed = repoCache.get(account.id)?.list.repos;
	if (listed?.length && !listed.some((r) => r.private)) {
		return `GitHub answers "Not Found" for ${fullName} with this token, and has listed no private repositories for it anywhere.`;
	}
	return getGithubToken(account.id)?.startsWith('github_pat_')
		? `This token can't see ${fullName}. A fine-grained token needs ${owner} as its resource owner, access to this repository (or all of ${owner}'s), and Contents permission; ${owner}'s owners may also have to approve it (${owner} → Settings → Personal access tokens → Pending requests).`
		: `This token can't see ${fullName}. A classic token needs the repo scope, and the account has to be able to open the repository on github.com.`;
}

// ── across every token ─────────────────────────────────────────────────

const tokenKind = (token: string): TokenAccess['kind'] =>
	token.startsWith('github_pat_') ? 'fine-grained' : token.startsWith('ghp_') ? 'classic' : token.startsWith('gho_') ? 'sign-in' : 'unknown';

const LEVELS = ['read', 'triage', 'write', 'maintain', 'admin'] as const;
const FROM_GITHUB = { pull: 'read', triage: 'triage', push: 'write', maintain: 'maintain', admin: 'admin' } as const;

/**
 * The tokens in the order a session should prefer them: those GitHub returns the repository
 * for; among them, those it reports write access for (sessions push), when any; then the
 * stricter first: fine-grained tokens (limited to chosen repositories and permissions) before
 * sign-ins and classic tokens, less access before more, fewer repositories listed before more.
 */
export function rankTokens(tokens: TokenAccess[]): TokenAccess[] {
	const level = (t: TokenAccess) => LEVELS.indexOf(t.access ?? 'read');
	const writes = (t: TokenAccess) => t.ok && level(t) >= LEVELS.indexOf('write');
	const anyWrites = tokens.some(writes);
	const kind = { 'fine-grained': 0, 'sign-in': 1, classic: 2, unknown: 3 };
	return [...tokens].sort(
		(a, b) =>
			Number(b.ok) - Number(a.ok) ||
			(anyWrites ? Number(writes(b)) - Number(writes(a)) : 0) ||
			kind[a.kind] - kind[b.kind] ||
			level(a) - level(b) ||
			(a.sees?.repos ?? Infinity) - (b.sees?.repos ?? Infinity)
	);
}

/** What each token gets for the repository, best first (see rankTokens). */
export async function repoAccess(fullName: string): Promise<{ repo: GithubRepo | null; tokens: TokenAccess[] }> {
	if (!FULL_NAME.test(fullName)) throw new BadRequest('Enter the repository as owner/name');
	let repo: GithubRepo | null = null;
	const tokens = await Promise.all(
		listGithubAccounts().map(async (account): Promise<TokenAccess> => {
			const token = getGithubToken(account.id) ?? '';
			const base = { accountId: account.id, kind: tokenKind(token), scopes: account.scopes, access: null, expires: null, sees: null, reason: null };
			const res = await ghFetch(token, `/repos/${fullName}`).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
			if (typeof res === 'string') return { ...base, ok: false, reason: res };
			const expires = res.headers.get('github-authentication-token-expiration');
			const listed = await listRepos(account).catch(() => null);
			const sees = listed ? { repos: listed.repos.length, private: listed.repos.filter((r) => r.private).length } : null;
			if (!res.ok) return { ...base, ok: false, expires, sees, reason: await missReason(account, fullName, res) };
			const data = (await res.json()) as GhRepo;
			repo ??= toRepo(data);
			const granted = (Object.keys(FROM_GITHUB) as (keyof typeof FROM_GITHUB)[]).filter((k) => data.permissions?.[k]).map((k) => FROM_GITHUB[k]);
			const access = granted.length ? LEVELS[Math.max(...granted.map((g) => LEVELS.indexOf(g)))] : null;
			return { ...base, ok: true, access, expires, sees };
		})
	);
	return { repo, tokens: rankTokens(tokens) };
}

/** Every token's repositories in one list, most recently pushed first; ?owner and ?search alike. */
export async function allRepos(how: { owner?: string; search?: string; refresh?: boolean } = {}): Promise<RepoList> {
	const accounts = listGithubAccounts();
	const results = await Promise.allSettled(
		accounts.map(async (a): Promise<RepoList> => {
			if (how.owner) return { repos: await ownerRepos(a, how.owner), notice: null };
			if (how.search) return { repos: await searchRepos(a, how.search), notice: null };
			return listRepos(a, how.refresh);
		})
	);
	const byName = new Map<string, GithubRepo>();
	const notices = new Set<string>();
	const errors: string[] = [];
	for (const r of results) {
		if (r.status === 'rejected') {
			errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
			continue;
		}
		for (const repo of r.value.repos) if (!byName.has(repo.fullName)) byName.set(repo.fullName, repo);
		if (r.value.notice) notices.add(r.value.notice);
	}
	// Only when no token answered: one token failing shouldn't hide the others' repos.
	if (accounts.length && errors.length === accounts.length) throw new BadRequest(errors[0]);
	const repos = [...byName.values()].sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
	return { repos, notice: [...notices].join(' ') || null };
}

export async function listBranches(account: GithubAccount | null, fullName: string): Promise<string[]> {
	if (!FULL_NAME.test(fullName)) throw new BadRequest('Invalid repository');
	const branches: string[] = [];
	for (let page = 1; page <= 5; page++) {
		const { data } = await gh<{ name: string }[]>(tokenOf(account), `/repos/${fullName}/branches?per_page=100&page=${page}`);
		branches.push(...data.map((b) => b.name));
		if (data.length < 100) break;
	}
	return branches;
}

type GhPull = {
	number: number;
	title: string;
	user: { login: string } | null;
	draft: boolean;
	state: 'open' | 'closed';
	merged_at: string | null;
	head: { ref: string; repo: { full_name: string } | null };
	updated_at: string;
	html_url: string;
};

const toPull = (p: GhPull): GithubPull => ({
	number: p.number,
	title: p.title,
	author: p.user?.login ?? null,
	draft: p.draft,
	headRef: p.head.ref,
	headRepo: p.head.repo?.full_name ?? null,
	updatedAt: p.updated_at,
	url: p.html_url
});

/** Open pull requests, most recently updated first, for "check out a pull request". */
export async function listPulls(account: GithubAccount | null, fullName: string): Promise<GithubPull[]> {
	if (!FULL_NAME.test(fullName)) throw new BadRequest('Invalid repository');
	const { data } = await gh<GhPull[]>(tokenOf(account), `/repos/${fullName}/pulls?state=open&sort=updated&direction=desc&per_page=50`);
	return data.map(toPull);
}

export async function getPull(account: GithubAccount | null, fullName: string, number: number): Promise<GithubPull> {
	if (!FULL_NAME.test(fullName)) throw new BadRequest('Invalid repository');
	const { data } = await gh<GhPull>(tokenOf(account), `/repos/${fullName}/pulls/${number}`);
	return toPull(data);
}

/** The newest pull request opened from `branch` of the repo, if any. */
export async function findPrForBranch(account: GithubAccount | null, fullName: string, branch: string): Promise<SessionPr | null> {
	const owner = fullName.split('/')[0];
	const q = new URLSearchParams({ head: `${owner}:${branch}`, state: 'all', per_page: '1' });
	const { data } = await gh<GhPull[]>(tokenOf(account), `/repos/${fullName}/pulls?${q}`);
	const p = data[0];
	if (!p) return null;
	return { number: p.number, url: p.html_url, state: p.merged_at ? 'merged' : p.state === 'closed' ? 'closed' : p.draft ? 'draft' : 'open' };
}

// ── device flow ────────────────────────────────────────────────────────

type Pending = { deviceCode: string; interval: number; expiresAt: number };
const pending = new Map<string, Pending>();

const clientId = () => getSettings().githubClientId || config.githubClientId;

export const deviceFlowEnabled = () => !!clientId();

async function postForm<T>(url: string, form: Record<string, string>): Promise<T> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'orbital' },
		body: new URLSearchParams(form),
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new BadRequest(`GitHub: ${res.statusText}`);
	return (await res.json()) as T;
}

export async function startDeviceFlow() {
	if (!clientId()) throw new BadRequest('Add a GitHub OAuth app under Settings to sign in with GitHub, or add a personal access token.');
	const r = await postForm<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number; error_description?: string }>(
		'https://github.com/login/device/code',
		{ client_id: clientId()!, scope: 'repo read:org workflow' }
	);
	if (!r.device_code) throw new BadRequest(r.error_description ?? 'GitHub did not start the sign-in');
	const handle = randomToken(16);
	pending.set(handle, { deviceCode: r.device_code, interval: r.interval, expiresAt: Date.now() + r.expires_in * 1000 });
	return { handle, userCode: r.user_code, verificationUri: r.verification_uri, interval: r.interval, expiresIn: r.expires_in };
}

/** One poll: `pending` until the user approves, then the saved account. */
export async function pollDeviceFlow(handle: string): Promise<{ state: 'pending' | 'done' | 'expired' | 'denied'; account?: GithubAccount; interval?: number }> {
	const p = pending.get(handle);
	if (!p || Date.now() > p.expiresAt) {
		pending.delete(handle);
		return { state: 'expired' };
	}
	const r = await postForm<{ access_token?: string; error?: string; interval?: number }>('https://github.com/login/oauth/access_token', {
		client_id: clientId()!,
		device_code: p.deviceCode,
		grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
	});
	if (r.access_token) {
		pending.delete(handle);
		return { state: 'done', account: await addGithubToken(r.access_token, 'oauth') };
	}
	if (r.error === 'slow_down') p.interval = r.interval ?? p.interval + 5;
	if (r.error === 'authorization_pending' || r.error === 'slow_down') return { state: 'pending', interval: p.interval };
	pending.delete(handle);
	return { state: r.error === 'access_denied' ? 'denied' : 'expired' };
}

export type TokenCheck = { label: string; path: string; status: number; answer: string; headers: Record<string, string> };

// Response headers that say what a token is and what GitHub wanted from it.
const TELLING = ['x-oauth-scopes', 'x-accepted-oauth-scopes', 'x-accepted-github-permissions', 'x-github-sso', 'github-authentication-token-expiration'];

/**
 * What GitHub answers this token, as it answers: no interpretation. Which token is stored
 * (its start and end), who it is, how many private repos it sees, and the repo asked about.
 */
export async function checkToken(account: GithubAccount, repo: string | null) {
	const token = getGithubToken(account.id) ?? '';
	const kind = token.startsWith('github_pat_') ? 'Fine-grained token' : token.startsWith('ghp_') ? 'Classic token' : token.startsWith('gho_') ? 'GitHub sign-in' : 'Unknown kind';
	const owner = repo?.split('/')[0];
	const probes: [string, string][] = [
		['Who the token is', '/user'],
		['Private repos in your list', '/user/repos?visibility=private&per_page=100'],
		...(owner ? ([[`${owner}'s private repos`, `/orgs/${owner}/repos?type=private&per_page=100`]] as [string, string][]) : []),
		...(repo ? ([[repo, `/repos/${repo}`]] as [string, string][]) : [])
	];
	const checks: TokenCheck[] = [];
	for (const [label, path] of probes) {
		const res = await ghFetch(token, path);
		const body = (await res.json().catch(() => null)) as unknown;
		let answer: string;
		if (Array.isArray(body)) answer = `${body.length} repos${body.length ? `: ${body.slice(0, 8).map((r: GhRepo) => r.full_name).join(', ')}${body.length > 8 ? '…' : ''}` : ''}`;
		else {
			const b = (body ?? {}) as { message?: string; login?: string; full_name?: string; private?: boolean };
			answer = b.message ?? (b.full_name ? `${b.full_name} (${b.private ? 'private' : 'public'})` : b.login ? `signed in as ${b.login}` : res.statusText);
		}
		const headers = Object.fromEntries(TELLING.flatMap((h) => (res.headers.get(h) ? [[h, res.headers.get(h)!]] : [])));
		checks.push({ label, path, status: res.status, answer, headers });
	}
	return { kind, token: token ? `${token.slice(0, token.startsWith('github_pat_') ? 16 : 8)}…${token.slice(-4)}` : '(none stored)', checks };
}
