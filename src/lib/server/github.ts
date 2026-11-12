/**
 * GitHub accounts: a personal access token (classic or fine-grained); "Sign in with GitHub"
 * through the device flow when ORB_GITHUB_CLIENT_ID names an OAuth app or a GitHub App (whose
 * sign-ins can expire, and are renewed); or a GitHub App's installation, acting as its bot.
 * Tokens list repositories and are handed to session containers for clone and push.
 */
import { createHash, createPublicKey, createSign } from 'node:crypto';
import { randomToken } from './crypto.ts';
import { config } from './config.ts';
import { BadRequest } from './http.ts';
import {
	getGithubAccount,
	getGithubClientSecret,
	getGithubRenewal,
	getGithubToken,
	getSettings,
	listGithubAccounts,
	setGithubOrgs,
	setGithubPermissions,
	setGithubRenewError,
	setGithubResourceOwner,
	setGithubToken,
	upsertGithubAccount,
	type GithubAccountInput,
	type GithubRenewal
} from './store.ts';
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
export async function addGithubToken(
	token: string,
	kind: GithubAccount['kind'],
	opts: { label?: string | null; replace?: string; expiresAt?: string | null; renewal?: GithubRenewal | null } = {}
): Promise<GithubAccount> {
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
		gitEmail: `${user.id}+${user.login}@users.noreply.github.com`,
		expiresAt: opts.expiresAt ?? null,
		renewal: opts.renewal ?? null
	};
	const account = upsertGithubAccount(input, opts);
	repoCache.delete(account.id);
	refreshGithubCredentials(account.id);
	// Its repos say whose a fine-grained token is, and which orgs it can open.
	await listRepos(account).catch(() => null);
	return getGithubAccount(account.id) ?? account;
}

export async function refreshOrgs(account: GithubAccount): Promise<string[]> {
	const token = getGithubToken(account.id);
	// An installation has the one account it's installed on.
	if (!token || account.kind === 'app') return account.orgs;
	const orgs = await orgsOf(token);
	setGithubOrgs(account.id, orgs);
	// And the organizations whose repos it can open, which the list above can miss.
	repoCache.delete(account.id);
	await listRepos({ ...account, orgs }).catch(() => null);
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

/** Classic tokens report their scopes; fine-grained ones don't (and are limited to one owner). */
export const isFineGrained = (a: Pick<GithubAccount, 'kind' | 'scopes'>) => a.kind === 'pat' && a.scopes === null;

function mostCommon(values: string[]): string | null {
	const n = new Map<string, number>();
	for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
	return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

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
	if (account.kind === 'app') {
		// An installation has no user: its repos are the ones it was given.
		for (let page = 1; page <= 10; page++) {
			const { data } = await gh<{ repositories: GhRepo[] }>(token, `/installation/repositories?per_page=100&page=${page}`);
			for (const r of data.repositories) byName.set(r.full_name, toRepo(r));
			if (data.repositories.length < 100) break;
		}
		const repos = [...byName.values()].sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
		const list = { repos, notice };
		repoCache.set(account.id, { at: Date.now(), list });
		return list;
	}
	for (let page = 1; page <= 10; page++) {
		const { data, headers } = await gh<GhRepo[]>(token, `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`);
		if (headers.get('x-github-sso')?.startsWith('partial-results')) notice = SSO_NOTICE;
		for (const r of data) byName.set(r.full_name, toRepo(r));
		if (data.length < 100) break;
	}
	if (isFineGrained(account)) {
		const owner = mostCommon([...byName.values()].map((r) => r.owner));
		if (owner && owner !== account.resourceOwner) setGithubResourceOwner(account.id, owner);
	}
	const orgs = new Set([...account.orgs, ...[...byName.values()].map((r) => r.owner)]);
	orgs.delete(account.login);
	const opened: string[] = [];
	await Promise.all(
		[...orgs].slice(0, 20).map(async (org) => {
			const res = await ghFetch(token, `/orgs/${org}/repos?type=all&sort=pushed&per_page=100`).catch(() => null);
			if (!res?.ok) return; // a user, not an org, or no access: the user's list has what there is
			opened.push(org);
			const data = (await res.json().catch(() => [])) as GhRepo[];
			if (Array.isArray(data)) for (const r of data) if (!byName.has(r.full_name)) byName.set(r.full_name, toRepo(r));
		})
	);
	// Organizations found this way count as the token's own (a new repo can go there): a
	// fine-grained token often can't list its organizations, but can open its org's repos.
	const found = opened.filter((o) => !account.orgs.includes(o));
	if (found.length) setGithubOrgs(account.id, [...account.orgs, ...found.sort()]);
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
	if (account.kind === 'app') {
		const on = account.resourceOwner;
		return on && on.toLowerCase() !== owner.toLowerCase()
			? `${account.name ?? 'The app'} is installed on ${on}, not ${owner}. Install it on ${owner} too (the app's page on GitHub → Install App), then add the app again here.`
			: `${account.name ?? 'The app'}'s installation on ${owner} doesn't include ${fullName}. On GitHub: ${owner} → Settings → GitHub Apps → ${account.name ?? 'the app'} → Configure → Repository access, add it. Check access here shows what the installation has.`;
	}
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
	token.startsWith('github_pat_') ? 'fine-grained' : token.startsWith('ghp_') ? 'classic' : /^gh[ou]_/.test(token) ? 'sign-in' : token.startsWith('ghs_') ? 'app' : 'unknown';

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
	const kind = { 'fine-grained': 0, app: 0, 'sign-in': 1, classic: 2, unknown: 3 };
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
/**
 * Each token's organizations, for a new repo's owner: the ones GitHub lists for it, and the
 * ones whose repos it can open (found by listing its repos, cached for a couple of minutes).
 */
export async function repoOwners(): Promise<{ accountId: string; orgs: string[] }[]> {
	await Promise.allSettled(listGithubAccounts().map((a) => listRepos(a)));
	return listGithubAccounts().map((a) => ({ accountId: a.id, orgs: a.orgs }));
}

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
	for (let page = 1; page <= 10; page++) {
		const { data } = await gh<{ name: string }[]>(tokenOf(account), `/repos/${fullName}/branches?per_page=100&page=${page}`);
		branches.push(...data.map((b) => b.name));
		if (data.length < 100) break;
	}
	return branches;
}

/** Branches starting with what's typed, past the listed ones (repos with a thousand or more). */
export async function searchBranches(account: GithubAccount | null, fullName: string, prefix: string): Promise<string[]> {
	if (!FULL_NAME.test(fullName)) throw new BadRequest('Invalid repository');
	const p = prefix.trim();
	if (!p || /[\s~^:?*[\\]/.test(p)) return [];
	const res = await ghFetch(tokenOf(account), `/repos/${fullName}/git/matching-refs/heads/${p.split('/').map(encodeURIComponent).join('/')}`);
	if (!res.ok) return [];
	const refs = (await res.json()) as { ref: string }[];
	return refs.slice(0, 50).map((r) => r.ref.replace(/^refs\/heads\//, ''));
}

type GhContent = { type: 'file' | 'dir' | 'symlink' | 'submodule'; path: string; size: number; content?: string; encoding?: string };

/**
 * A folder of a repo (or one file) at a branch, for a Library skill: the newest commit that
 * touched it, and, when that differs from `knownSha`, its files. Small skills only: up to 50
 * files and 2 MB.
 */
export async function fetchRepoFolder(
	account: GithubAccount | null,
	fullName: string,
	path: string,
	ref: string | null,
	knownSha: string | null = null
): Promise<{ ref: string; sha: string | null; files: Record<string, Buffer> | null }> {
	if (!FULL_NAME.test(fullName)) throw new BadRequest('Enter the repository as owner/name');
	const token = tokenOf(account);
	const branch = ref || (await gh<{ default_branch: string }>(token, `/repos/${fullName}`)).data.default_branch;
	const clean = path.replace(/^\/+|\/+$/g, '');
	const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
	const commits = await gh<{ sha: string }[]>(token, `/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(clean)}&per_page=1`);
	const sha = commits.data[0]?.sha ?? null;
	if (!sha) throw new BadRequest(`${fullName} has no ${clean} on ${branch}`);
	if (sha === knownSha) return { ref: branch, sha, files: null };
	const files: Record<string, Buffer> = {};
	let total = 0;
	async function walk(p: string, rel: string) {
		const res = await ghFetch(token, `/repos/${fullName}/contents/${enc(p)}?ref=${encodeURIComponent(branch)}`);
		if (!res.ok) throw new BadRequest(res.status === 404 ? `${fullName} has no ${p} on ${branch}` : `GitHub: ${res.statusText}`);
		const body = (await res.json()) as GhContent | GhContent[];
		for (const item of Array.isArray(body) ? body : [body]) {
			const name = Array.isArray(body) ? `${rel}${item.path.split('/').pop()}` : (item.path.split('/').pop() ?? 'SKILL.md');
			if (item.type === 'dir') await walk(item.path, `${name}/`);
			else if (item.type === 'file') {
				if (Object.keys(files).length >= 50) throw new BadRequest('That skill has more than 50 files');
				total += item.size;
				if (total > 2 * 1024 * 1024) throw new BadRequest('That skill is over 2 MB');
				const c = item.content !== undefined ? item : ((await gh<GhContent>(token, `/repos/${fullName}/contents/${enc(item.path)}?ref=${encodeURIComponent(branch)}`)).data);
				files[name] = Buffer.from(c.content ?? '', 'base64');
			}
		}
	}
	await walk(clean, '');
	return { ref: branch, sha, files };
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
	const { data } = await gh<GhPull[]>(tokenOf(account), `/repos/${fullName}/pulls?state=open&sort=updated&direction=desc&per_page=100`);
	return data.map(toPull);
}

type GhIssue = { number: number; title: string; user: { login: string } | null; draft?: boolean; updated_at: string; html_url: string };

/**
 * Pull requests past the list of open ones: one by number ("1234" or "#1234", in any state), or
 * open ones whose title or body has every word typed, through GitHub's search.
 */
export async function searchPulls(account: GithubAccount | null, fullName: string, query: string): Promise<GithubPull[]> {
	if (!FULL_NAME.test(fullName)) throw new BadRequest('Invalid repository');
	const q = query.trim();
	const n = /^#?(\d{1,9})$/.exec(q)?.[1];
	if (n) {
		const res = await ghFetch(tokenOf(account), `/repos/${fullName}/pulls/${n}`);
		return res.ok ? [toPull((await res.json()) as GhPull)] : [];
	}
	const words = q.replace(/[^\w.\-/ ]+/g, ' ').trim();
	if (!words) return [];
	const { data } = await gh<{ items: GhIssue[] }>(tokenOf(account), `/search/issues?q=${encodeURIComponent(`${words} repo:${fullName} is:pr is:open`)}&sort=updated&per_page=20`);
	return data.items.map((i) => ({ number: i.number, title: i.title, author: i.user?.login ?? null, draft: !!i.draft, headRef: '', headRepo: null, updatedAt: i.updated_at, url: i.html_url }));
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
	if (!clientId()) throw new BadRequest('Add a GitHub OAuth app or GitHub App under Settings to sign in with GitHub, or add a token or a GitHub App under Accounts.');
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
	const r = await postForm<TokenAnswer & { interval?: number }>('https://github.com/login/oauth/access_token', {
		client_id: clientId()!,
		device_code: p.deviceCode,
		grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
	});
	if (r.access_token) {
		pending.delete(handle);
		// A GitHub App's sign-ins expire (8 hours by default) and come with a refresh token.
		return { state: 'done', account: await addGithubToken(r.access_token, 'oauth', renewalOf(r)) };
	}
	if (r.error === 'slow_down') p.interval = r.interval ?? p.interval + 5;
	if (r.error === 'authorization_pending' || r.error === 'slow_down') return { state: 'pending', interval: p.interval };
	pending.delete(handle);
	return { state: r.error === 'access_denied' ? 'denied' : 'expired' };
}

type TokenAnswer = { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; error?: string; error_description?: string };

const inSeconds = (n: number | undefined) => (n ? new Date(Date.now() + n * 1000).toISOString() : null);

/** A token answer's expiry and refresh token, if it has them (a GitHub App's expiring sign-in). */
function renewalOf(r: TokenAnswer): { expiresAt: string | null; renewal: GithubRenewal | null } {
	return {
		expiresAt: inSeconds(r.expires_in),
		renewal: r.refresh_token ? { kind: 'refresh', refreshToken: r.refresh_token, refreshExpiresAt: inSeconds(r.refresh_token_expires_in) } : null
	};
}

// ── GitHub Apps ────────────────────────────────────────────────────────

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** The app's own short-lived token (a JWT signed with its private key), to ask for installation tokens. */
export function appJwt(appId: string, privateKey: string, now = Date.now()): string {
	const iat = Math.floor(now / 1000) - 60; // GitHub's clock may be behind ours
	const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const body = b64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: appId }));
	const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
	return `${head}.${body}.${b64url(sig)}`;
}

/** The fingerprint GitHub lists for an app's private key (the app's settings page → Private keys). */
export function keyFingerprint(privateKey: string): string {
	const der = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
	return `SHA256:${createHash('sha256').update(der).digest('base64')}`;
}

type AppKey = { appId: string; privateKey: string };

/**
 * A call as the app itself (a JWT signed with its key). GitHub answers "Bad credentials" to every
 * kind of bad JWT, so when it does, this says which it is: this server's clock (GitHub's reply
 * has GitHub's time), or else the App ID or key, with the key's fingerprint to compare.
 */
async function appCall<T>(app: AppKey, path: string, method = 'GET'): Promise<T> {
	let jwt: string;
	try {
		jwt = appJwt(app.appId, app.privateKey);
	} catch {
		throw new BadRequest("Orbital can't sign with this private key: use the .pem GitHub generated for the app.");
	}
	const res = await ghFetch(jwt, path, { method, ...(method === 'POST' ? { body: {} } : {}) });
	const b = (await res.json().catch(() => ({}))) as T & { message?: string };
	if (res.ok) return b;
	if (res.status !== 401) throw new BadRequest(`GitHub: ${b.message ?? res.statusText}`);
	const said = b.message ? ` (“${b.message}”)` : '';
	const github = Date.parse(res.headers.get('date') ?? '');
	const skew = Number.isFinite(github) ? Math.round((Date.now() - github) / 1000) : 0;
	if (Math.abs(skew) > 30) {
		throw new BadRequest(
			`GitHub turned the app down${said}: this server's clock is ${Math.abs(skew)} seconds ${skew > 0 ? 'ahead of' : 'behind'} GitHub's, and GitHub only accepts an app's sign-in within a minute. Set the server's time (NTP), then try again.`
		);
	}
	throw new BadRequest(
		`GitHub turned the app down${said}. This server's clock agrees with GitHub's, so it's the ID or the key: check that ${app.appId} is this app's App ID or Client ID, and that the key's fingerprint, ${keyFingerprint(app.privateKey)}, is listed under Private keys on the app's settings page.`
	);
}

/** An hour-long token for the installation, with the permissions GitHub granted it (as accepted by the account's owners). */
async function installationToken(appId: string, privateKey: string, installationId: number): Promise<{ token: string; expiresAt: string; permissions: Record<string, string> | null }> {
	const r = await appCall<{ token: string; expires_at: string; permissions?: Record<string, string> }>({ appId, privateKey }, `/app/installations/${installationId}/access_tokens`, 'POST');
	return { token: r.token, expiresAt: r.expires_at, permissions: r.permissions ?? null };
}

type GhInstallation = { id: number; account: { login: string; type: string; avatar_url: string } | null };

/**
 * Connects a GitHub App: one connection per installation, acting as the app's bot on the
 * account it's installed on, with an hour-long token Orbital keeps renewing.
 */
export async function addGithubApp(appId: string, privateKey: string, label: string | null): Promise<GithubAccount[]> {
	// GitHub takes either as the JWT's issuer, and recommends the Client ID.
	if (!/^\d{1,12}$/.test(appId) && !/^Iv[A-Za-z0-9._-]{4,50}$/.test(appId)) throw new BadRequest("Use the app's App ID (a number) or its Client ID (Iv…), both at the top of the app's settings page");
	const key = privateKey.trim();
	if (!/^-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----$/.test(key)) throw new BadRequest('Paste the whole private key (.pem), from -----BEGIN to -----END');
	const app = await appCall<{ slug: string; name: string }>({ appId, privateKey: key }, '/app');
	const installations = await appCall<GhInstallation[]>({ appId, privateKey: key }, '/app/installations?per_page=100');
	if (!installations.length) throw new BadRequest(`${app.name} isn't installed anywhere yet. Install it on the organization (the app's page → Install App), then add it again.`);
	// Commits from sessions use the bot's noreply address.
	const bot = `${app.slug}[bot]`;
	const botUser = (await ghFetch(undefined, `/users/${encodeURIComponent(bot)}`).then((r) => (r.ok ? (r.json() as Promise<{ id: number }>) : null)))?.id;
	const out: GithubAccount[] = [];
	for (const inst of installations) {
		const owner = inst.account?.login ?? null;
		const t = await installationToken(appId, key, inst.id);
		const account = upsertGithubAccount(
			{
				login: bot,
				name: app.name,
				avatarUrl: inst.account?.avatar_url ?? null,
				kind: 'app',
				token: t.token,
				scopes: null,
				orgs: owner && inst.account?.type === 'Organization' ? [owner] : [],
				gitName: bot,
				gitEmail: botUser ? `${botUser}+${bot}@users.noreply.github.com` : `${bot}@users.noreply.github.com`,
				expiresAt: t.expiresAt,
				renewal: { kind: 'app', appId, privateKey: key, installationId: inst.id }
			},
			{ label: label ?? (installations.length > 1 && owner ? `${app.name} · ${owner}` : app.name) }
		);
		setGithubResourceOwner(account.id, owner);
		setGithubPermissions(account.id, t.permissions);
		repoCache.delete(account.id);
		refreshGithubCredentials(account.id);
		out.push(getGithubAccount(account.id)!);
	}
	return out;
}

// ── renewal ────────────────────────────────────────────────────────────

// Renew this long before a token runs out; installation tokens last an hour, sign-ins eight.
const RENEW_BEFORE = 10 * 60_000;
const lastTry = new Map<string, number>();

/** A new token for a connection that renews, saved and handed to its running sessions. */
export async function renewGithubToken(id: string): Promise<void> {
	const r = getGithubRenewal(id);
	if (!r) return;
	try {
		if (r.kind === 'app') {
			const t = await installationToken(r.appId, r.privateKey, r.installationId);
			setGithubToken(id, t.token, t.expiresAt);
			setGithubPermissions(id, t.permissions);
		} else {
			const secret = getGithubClientSecret();
			if (!secret) throw new Error("Add the GitHub App's client secret under Settings: GitHub asks for it to renew a sign-in.");
			if (r.refreshExpiresAt && Date.parse(r.refreshExpiresAt) < Date.now()) throw new Error('The sign-in ran out. Sign in with GitHub again.');
			const a = await postForm<TokenAnswer>('https://github.com/login/oauth/access_token', {
				client_id: clientId() ?? '',
				client_secret: secret,
				grant_type: 'refresh_token',
				refresh_token: r.refreshToken
			});
			if (!a.access_token) throw new Error(a.error === 'bad_refresh_token' ? 'GitHub no longer accepts this sign-in. Sign in with GitHub again.' : `GitHub: ${a.error_description ?? a.error ?? 'no token'}`);
			const next = renewalOf(a);
			setGithubToken(id, a.access_token, next.expiresAt, next.renewal ?? r);
		}
		refreshGithubCredentials(id);
	} catch (err) {
		setGithubRenewError(id, err instanceof Error ? err.message : String(err));
		throw err;
	}
}

/** Renews every token about to run out (from the live poll); a failure is retried every few minutes. */
export async function renewGithubTokens(now = Date.now()) {
	for (const a of listGithubAccounts()) {
		if (!a.renews || !a.expiresAt || Date.parse(a.expiresAt) - now > RENEW_BEFORE) continue;
		if (now - (lastTry.get(a.id) ?? 0) < (a.renewError ? 5 * 60_000 : 30_000)) continue;
		lastTry.set(a.id, now);
		await renewGithubToken(a.id).catch((err) => console.error(`[orbital] renewing GitHub token ${a.label ?? a.login}:`, err instanceof Error ? err.message : err));
	}
}

export type TokenCheck = { label: string; path: string; status: number; answer: string; headers: Record<string, string> };

// Response headers that say what a token is and what GitHub wanted from it.
const TELLING = ['x-oauth-scopes', 'x-accepted-oauth-scopes', 'x-accepted-github-permissions', 'x-github-sso', 'github-authentication-token-expiration'];

/**
 * What GitHub answers this token, as it answers: no interpretation. Which token is stored
 * (its start and end), who it is, how many private repos it sees, and the repo asked about.
 */
/**
 * What GitHub says about a GitHub App's installation: the account it's on, which repositories it
 * was given, its permissions (as accepted by the account's owners), and whether it has the repo.
 */
async function checkInstallation(account: GithubAccount, repo: string | null): Promise<TokenCheck[]> {
	const token = getGithubToken(account.id) ?? '';
	const r = getGithubRenewal(account.id);
	const checks: TokenCheck[] = [];
	const push = (label: string, path: string, res: Response, answer: string) =>
		checks.push({ label, path, status: res.status, answer, headers: Object.fromEntries(TELLING.flatMap((h) => (res.headers.get(h) ? [[h, res.headers.get(h)!]] : []))) });
	if (r?.kind === 'app') {
		const path = `/app/installations/${r.installationId}`;
		const res = await ghFetch(appJwt(r.appId, r.privateKey), path);
		const b = (await res.json().catch(() => ({}))) as {
			message?: string;
			account?: { login: string };
			repository_selection?: string;
			permissions?: Record<string, string>;
			suspended_at?: string | null;
		};
		const perms = Object.entries(b.permissions ?? {})
			.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
			.join(', ');
		push(
			'The installation',
			path,
			res,
			res.ok
				? `on ${b.account?.login} · ${b.repository_selection === 'all' ? 'all repositories' : 'selected repositories only'}${b.suspended_at ? ' · SUSPENDED' : ''} · ${perms || 'no permissions'}`
				: (b.message ?? res.statusText)
		);
	}
	const listPath = '/installation/repositories?per_page=100';
	const list = await ghFetch(token, listPath);
	const lb = (await list.json().catch(() => ({}))) as { message?: string; total_count?: number; repositories?: GhRepo[] };
	const names = (lb.repositories ?? []).map((x) => x.full_name);
	const has = repo ? names.some((n) => n.toLowerCase() === repo.toLowerCase()) : null;
	push(
		'Repositories it was given',
		listPath,
		list,
		list.ok
			? `${lb.total_count ?? names.length}${names.length ? `: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}` : ''}${repo ? (has ? ` · includes ${repo}` : ` · ${repo} is not among them${(lb.total_count ?? 0) > 100 ? ' (in the first 100)' : ''}`) : ''}`
			: (lb.message ?? list.statusText)
	);
	if (repo) {
		const res = await ghFetch(token, `/repos/${repo}`);
		const b = (await res.json().catch(() => ({}))) as { message?: string; full_name?: string; private?: boolean };
		push(repo, `/repos/${repo}`, res, b.full_name ? `${b.full_name} (${b.private ? 'private' : 'public'})` : (b.message ?? res.statusText));
	}
	return checks;
}

export async function checkToken(account: GithubAccount, repo: string | null) {
	const token = getGithubToken(account.id) ?? '';
	if (account.kind === 'app') {
		return { kind: 'GitHub App installation', token: token ? `${token.slice(0, 8)}…${token.slice(-4)}` : '(none stored)', checks: await checkInstallation(account, repo) };
	}
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
