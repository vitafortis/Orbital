import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The store opens its database on first use, under ORB_DATA_DIR.
process.env.ORB_DATA_DIR = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_SECRET_KEY = 'test-key';
const store = await import('#lib/server/store.ts');

const input = (token: string, kind: 'pat' | 'oauth' = 'pat') => ({
	login: 'octo',
	name: 'Octo Cat',
	avatarUrl: null,
	kind,
	token,
	scopes: null,
	orgs: [],
	gitName: 'Octo Cat',
	gitEmail: '1+octo@users.noreply.github.com'
});

test('several named tokens for one GitHub login', () => {
	const work = store.upsertGithubAccount(input('tok-work'), { label: 'Work org' });
	const home = store.upsertGithubAccount(input('tok-home'), { label: 'Personal' });
	assert.notEqual(work.id, home.id);
	assert.deepEqual(
		store.listGithubAccounts().map((a) => a.label),
		['Work org', 'Personal']
	);

	// The same token again updates its connection instead of adding one.
	const again = store.upsertGithubAccount(input('tok-work'));
	assert.equal(again.id, work.id);
	assert.equal(again.label, 'Work org');
	assert.equal(store.listGithubAccounts().length, 2);

	// Replacing keeps the id (sessions refer to it) and can rename.
	const swapped = store.upsertGithubAccount(input('tok-work-2'), { label: 'Work', replace: work.id });
	assert.equal(swapped.id, work.id);
	assert.equal(swapped.label, 'Work');
	assert.equal(store.getGithubToken(work.id), 'tok-work-2');

	store.setGithubLabel(home.id, '');
	assert.equal(store.getGithubAccount(home.id)?.label, null);
});

test('signing in with GitHub again replaces that login’s signed-in connection', () => {
	const a = store.upsertGithubAccount(input('oauth-1', 'oauth'));
	const b = store.upsertGithubAccount(input('oauth-2', 'oauth'));
	assert.equal(a.id, b.id);
	assert.equal(store.getGithubToken(a.id), 'oauth-2');
});

// GitHub's answers, faked: what each kind of token gets for a repo it can't see.
const github = await import('#lib/server/github.ts');
function fakeGithub(handler: (url: URL) => Response) {
	const real = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL) => handler(new URL(String(input)))) as typeof fetch;
	return () => (globalThis.fetch = real);
}
const repoJson = (full: string) => ({ full_name: full, name: full.split('/')[1], owner: { login: full.split('/')[0] }, private: true, default_branch: 'main', description: null, pushed_at: null, html_url: `https://github.com/${full}` });

test('lookupRepo explains why a token cannot see a repo', async () => {
	const fine = store.upsertGithubAccount(input('github_pat_abc'), { label: 'Org' });
	const classic = store.upsertGithubAccount(input('ghp_abc'), { label: 'Classic' });
	let restore = fakeGithub(() => new Response('{"message":"Not Found"}', { status: 404 }));
	await assert.rejects(github.lookupRepo(fine, 'Acme/tier'), /resource owner.*Pending requests/);
	await assert.rejects(github.lookupRepo(classic, 'Acme/tier'), /repo scope/);
	restore();
	restore = fakeGithub(() => new Response('{"message":"Not Found"}', { status: 404, headers: { 'x-github-sso': 'required; url=https://github.com/orgs/Acme/sso?authorization_request=1' } }));
	await assert.rejects(github.lookupRepo(classic, 'Acme/tier'), /single sign-on: authorize this token for it at https:\/\/github.com\/orgs\/Acme\/sso/);
	restore();
	restore = fakeGithub(() => Response.json(repoJson('Acme/tier')));
	assert.equal((await github.lookupRepo(fine, 'Acme/tier')).fullName, 'Acme/tier');
	restore();
});

test('searchRepos asks GitHub by name among the known owners; the list flags SSO gaps', async () => {
	const a = store.upsertGithubAccount({ ...input('ghp_search'), orgs: ['Acme'] }, { label: 'Search' });
	let asked = '';
	const restore = fakeGithub((url) => {
		if (url.pathname === '/user/repos') return Response.json([repoJson('octo/one')], { headers: { 'x-github-sso': 'partial-results; organizations=1' } });
		if (url.pathname.startsWith('/orgs/')) return Response.json([]);
		asked = url.searchParams.get('q') ?? '';
		return Response.json({ items: [repoJson('Acme/tier-service')] });
	});
	const list = await github.listRepos(a, true);
	assert.match(list.notice ?? '', /single sign-on/);
	const found = await github.searchRepos(a, 'tier');
	assert.equal(found[0].fullName, 'Acme/tier-service');
	assert.match(asked, /^tier in:name user:octo user:Acme/);
	restore();
});

test("listRepos adds each organization's own list, where a token's private org repos show up", async () => {
	const a = store.upsertGithubAccount(input('github_pat_org'), { label: 'Org token' });
	const restore = fakeGithub((url) => {
		// The user's list has only Acme's public repo; Acme's own list has the private one too.
		if (url.pathname === '/user/repos') return Response.json([{ ...repoJson('Acme/site'), private: false }]);
		if (url.pathname === '/orgs/Acme/repos') return Response.json([{ ...repoJson('Acme/site'), private: false }, repoJson('Acme/tier')]);
		if (url.pathname === '/orgs/Hidden/repos') return Response.json([repoJson('Hidden/one'), repoJson('Hidden/two')]);
		return new Response('{"message":"Not Found"}', { status: 404 });
	});
	const list = await github.listRepos(a, true);
	assert.deepEqual(list.repos.map((r) => r.fullName).sort(), ['Acme/site', 'Acme/tier']);
	// An org nothing points to is listed when asked for by name ("Hidden/" in the picker).
	assert.equal((await github.ownerRepos(a, 'Hidden')).length, 2);
	restore();
});

test('lookupRepo says so when GitHub lists no private repo for the token', async () => {
	const a = store.upsertGithubAccount(input('github_pat_public'), { label: 'Public only' });
	const restore = fakeGithub((url) => {
		if (url.pathname === '/user/repos' || url.pathname.startsWith('/orgs/')) return Response.json([{ ...repoJson('Acme/site'), private: false }]);
		return new Response('{"message":"Not Found"}', { status: 404 });
	});
	await github.listRepos(a, true);
	await assert.rejects(github.lookupRepo(a, 'Acme/tier'), /"Not Found" for Acme\/tier.*no private repositories/);
	restore();
});

test('checkToken reports which token is stored and what GitHub answers, as is', async () => {
	const a = store.upsertGithubAccount(input('github_pat_11ABCDEFG0123456789wxyz'), { label: 'Checked' });
	const restore = fakeGithub((url) => {
		if (url.pathname === '/user') return Response.json({ login: 'octo' });
		if (url.pathname === '/repos/Acme/tier') return new Response('{"message":"Not Found"}', { status: 404, headers: { 'x-accepted-github-permissions': 'metadata=read' } });
		return Response.json([repoJson('Acme/tier')]);
	});
	const r = await github.checkToken(a, 'Acme/tier');
	assert.equal(r.kind, 'Fine-grained token');
	assert.equal(r.token, 'github_pat_11ABC…wxyz');
	assert.deepEqual(r.checks.map((c) => c.status), [200, 200, 200, 404]);
	assert.equal(r.checks[3].headers['x-accepted-github-permissions'], 'metadata=read');
	restore();
});

test('repoAccess asks every token and puts the stricter one that works first', async () => {
	for (const a of store.listGithubAccounts()) store.deleteGithubAccount(a.id);
	const classic = store.upsertGithubAccount(input('ghp_wide'), { label: 'Classic' });
	const fine = store.upsertGithubAccount(input('github_pat_narrow'), { label: 'Fine' });
	const reader = store.upsertGithubAccount(input('github_pat_reader'), { label: 'Reader' });
	const none = store.upsertGithubAccount(input('github_pat_none'), { label: 'None' });
	// Each token gets its own answer, by the authorization header.
	const real = globalThis.fetch;
	globalThis.fetch = (async (req: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(req));
		const auth = new Headers(init?.headers).get('authorization') ?? '';
		if (url.pathname !== '/repos/Acme/tier') return Response.json([]);
		const perms = { ghp_wide: { admin: true, push: true, pull: true }, github_pat_narrow: { push: true, pull: true }, github_pat_reader: { pull: true } }[auth.replace('Bearer ', '')];
		return perms ? Response.json({ ...repoJson('Acme/tier'), permissions: perms }, { headers: { 'github-authentication-token-expiration': '2027-01-01 00:00:00 UTC' } }) : new Response('{"message":"Not Found"}', { status: 404 });
	}) as typeof fetch;
	const r = await github.repoAccess('Acme/tier');
	globalThis.fetch = real;
	assert.equal(r.repo?.fullName, 'Acme/tier');
	// Write access first (sessions push), then fine-grained before classic; the reader and the token that can't see it last.
	assert.deepEqual(
		r.tokens.map((t) => [t.accountId, t.ok, t.access]),
		[
			[fine.id, true, 'write'],
			[classic.id, true, 'admin'],
			[reader.id, true, 'read'],
			[none.id, false, null]
		]
	);
	assert.equal(r.tokens[0].kind, 'fine-grained');
	assert.equal(r.tokens[0].expires, '2027-01-01 00:00:00 UTC');
	assert.match(r.tokens[3].reason ?? '', /fine-grained token needs Acme/);
});

test('rankTokens prefers the stricter token when none reports write access', () => {
	const t = (accountId: string, kind: 'fine-grained' | 'classic', repos: number) => ({ accountId, ok: true, access: 'read' as const, kind, scopes: null, expires: null, sees: { repos, private: 0 }, reason: null });
	assert.deepEqual(
		github.rankTokens([t('wide', 'fine-grained', 300), t('classic', 'classic', 1), t('narrow', 'fine-grained', 1)]).map((x) => x.accountId),
		['narrow', 'wide', 'classic']
	);
});

test("an org-scoped token that can't list its orgs still offers its org as a new repo's owner", async () => {
	const t = store.upsertGithubAccount(input('github_pat_org'), { label: 'Armistice' });
	assert.deepEqual(t.orgs, []);
	const restore = fakeGithub((url) => {
		if (url.pathname === '/user/repos') return Response.json([repoJson('armistice/tierity'), repoJson('someone/shared')]);
		if (url.pathname === '/orgs/armistice/repos') return Response.json([repoJson('armistice/tierity'), repoJson('armistice/site')]);
		// A user, not an org.
		return new Response('{"message":"Not Found"}', { status: 404 });
	});
	const owners = await github.repoOwners();
	restore();
	assert.deepEqual(owners.find((o) => o.accountId === t.id)?.orgs, ['armistice']);
	assert.deepEqual(store.getGithubAccount(t.id)?.orgs, ['armistice']);
	// Fine-grained, and most of what it lists is armistice's: it's armistice's token.
	assert.equal(store.getGithubAccount(t.id)?.resourceOwner, 'armistice');
});

test('githubKind tells org tokens from personal ones, classic tokens and sign-ins', async () => {
	const { githubKind } = await import('#lib/client/format.ts');
	const a = { kind: 'pat' as const, scopes: null, login: 'nathan', resourceOwner: null };
	assert.deepEqual(githubKind({ ...a, resourceOwner: 'armistice' }), { label: 'Org token · armistice', org: 'armistice' });
	assert.deepEqual(githubKind({ ...a, resourceOwner: 'nathan' }), { label: 'Personal token', org: null });
	assert.deepEqual(githubKind(a), { label: 'Fine-grained token', org: null });
	assert.deepEqual(githubKind({ ...a, scopes: 'repo, read:org' }), { label: 'Classic token', org: null });
	assert.deepEqual(githubKind({ ...a, kind: 'oauth', scopes: 'repo' }), { label: 'GitHub sign-in', org: null });
});
