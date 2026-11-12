import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_DATA_DIR = dataDir;
process.env.ORB_SESSIONS_DIR = join(dataDir, 'sessions');
process.env.ORB_SECRET_KEY = 'test-key';
const store = await import('#lib/server/store.ts');
const github = await import('#lib/server/github.ts');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

type Call = { method: string; path: string; auth: string | null; form: URLSearchParams | null };
function fakeGithub(handler: (c: Call) => Response) {
	const calls: Call[] = [];
	const real = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const h = new Headers(init?.headers);
		const form = h.get('content-type')?.includes('form') ? new URLSearchParams(String(init?.body)) : null;
		const c = { method: init?.method ?? 'GET', path: url.pathname + url.search, auth: h.get('authorization'), form };
		calls.push(c);
		return handler(c);
	}) as typeof fetch;
	return { calls, restore: () => (globalThis.fetch = real) };
}

test("appJwt is signed with the app's key and names the app", () => {
	const jwt = github.appJwt('123', pem, Date.parse('2026-11-09T12:00:00Z'));
	const [h, b, sig] = jwt.split('.');
	assert.ok(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(sig, 'base64url')));
	const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
	assert.equal(claims.iss, '123');
	assert.equal(claims.exp - claims.iat, 540);
});

test('a GitHub App becomes one connection per installation, acting as its bot, and renews', async () => {
	let n = 0;
	const gh = fakeGithub((c) => {
		if (c.path === '/app') return Response.json({ slug: 'orbital-ironclad', name: 'Orbital for Ironclad' });
		if (c.path.startsWith('/app/installations?')) return Response.json([{ id: 42, account: { login: 'ironclad', type: 'Organization', avatar_url: null } }]);
		if (c.path === '/app/installations/42/access_tokens') return Response.json({ token: `ghs_${++n}`, expires_at: new Date(Date.now() + (n === 1 ? 5 : 60) * 60_000).toISOString() });
		if (c.path === '/users/orbital-ironclad%5Bbot%5D') return Response.json({ id: 99 });
		if (c.path.startsWith('/installation/repositories')) return Response.json({ repositories: [{ full_name: 'ironclad/api', name: 'api', owner: { login: 'ironclad' }, private: true, default_branch: 'main', description: null, pushed_at: null, html_url: '' }] });
		return new Response('{}', { status: 404 });
	});
	const [a] = await github.addGithubApp('123', pem, null);
	assert.equal(a.kind, 'app');
	assert.equal(a.login, 'orbital-ironclad[bot]');
	assert.equal(a.label, 'Orbital for Ironclad');
	assert.equal(a.resourceOwner, 'ironclad');
	assert.deepEqual(a.orgs, ['ironclad']);
	assert.ok(a.renews);
	assert.equal(store.getGithubToken(a.id), 'ghs_1');
	assert.deepEqual(store.getGitIdentity(a.id), { name: 'orbital-ironclad[bot]', email: '99+orbital-ironclad[bot]@users.noreply.github.com' });
	// The app's JWT asks for installation tokens; the installation token lists repos.
	assert.match(gh.calls.find((c) => c.path === '/app/installations/42/access_tokens')!.auth!, /^Bearer ey/);
	assert.deepEqual((await github.listRepos(a, true)).repos.map((r) => r.fullName), ['ironclad/api']);

	// Five minutes left: renewed. Adding the app again keeps the same connection.
	await github.renewGithubTokens();
	assert.equal(store.getGithubToken(a.id), 'ghs_2');
	await github.renewGithubTokens();
	assert.equal(store.getGithubToken(a.id), 'ghs_2', 'an hour left: nothing to do');
	const again = await github.addGithubApp('123', pem, null);
	assert.equal(again[0].id, a.id);
	assert.equal(store.listGithubAccounts().length, 1);
	gh.restore();
});

test("a GitHub App's expiring sign-in is renewed with its refresh token and the client secret", async () => {
	store.saveSettings({ ...store.getSettings(), githubClientId: 'Iv23liclientid' });
	const user = { id: 7, login: 'nathan', name: 'Nathan', avatar_url: null };
	let token = 'ghu_old';
	const gh = fakeGithub((c) => {
		if (c.path === '/user') return Response.json(user, { headers: {} });
		if (c.path.startsWith('/user/')) return Response.json([]);
		if (c.path === '/login/oauth/access_token' && c.form?.get('grant_type') === 'refresh_token') {
			if (c.form.get('refresh_token') !== 'ghr_1') return Response.json({ error: 'bad_refresh_token' });
			token = 'ghu_new';
			return Response.json({ access_token: token, refresh_token: 'ghr_2', expires_in: 28800, refresh_token_expires_in: 15897600 });
		}
		return new Response('{}', { status: 404 });
	});
	const a = await github.addGithubToken(token, 'oauth', {
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		renewal: { kind: 'refresh', refreshToken: 'ghr_1', refreshExpiresAt: null }
	});
	assert.ok(a.renews);

	// Without the client secret, GitHub can't renew it: the connection says why.
	await assert.rejects(github.renewGithubToken(a.id), /client secret/);
	assert.match(store.getGithubAccount(a.id)!.renewError!, /client secret/);

	store.setGithubClientSecret('0123456789abcdef0123456789abcdef01234567');
	assert.equal(store.getSettings().githubClientSecretSet, true);
	await github.renewGithubToken(a.id);
	assert.equal(store.getGithubToken(a.id), 'ghu_new');
	const after = store.getGithubAccount(a.id)!;
	assert.equal(after.renewError, null);
	assert.ok(Date.parse(after.expiresAt!) > Date.now() + 7 * 3600_000);
	const r = store.getGithubRenewal(a.id);
	assert.equal(r?.kind === 'refresh' && r.refreshToken, 'ghr_2');
	const refresh = gh.calls.find((c) => c.form?.get('grant_type') === 'refresh_token')!;
	assert.equal(refresh.form!.get('client_id'), 'Iv23liclientid');
	assert.equal(refresh.form!.get('client_secret'), '0123456789abcdef0123456789abcdef01234567');
	// The secret is stored encrypted, not in the settings.
	const onDisk = ['orbital.db', 'orbital.db-wal'].map((f) => (existsSync(join(dataDir, f)) ? readFileSync(join(dataDir, f)).toString('latin1') : '')).join('');
	assert.match(onDisk, /github_accounts/, 'reads the database');
	assert.doesNotMatch(onDisk, /0123456789abcdef0123456789abcdef01234567|ghu_new|ghr_2/);
	gh.restore();
});

test("for an app that can't open a repo, Orbital says what the installation has and what's missing", async () => {
	const repo = (full: string) => ({ full_name: full, name: full.split('/')[1], owner: { login: full.split('/')[0] }, private: true, default_branch: 'main', description: null, pushed_at: null, html_url: '' });
	const gh = fakeGithub((c) => {
		if (c.path === '/app') return Response.json({ slug: 'orbital-ironclad', name: 'Orbital for Ironclad' });
		if (c.path.startsWith('/app/installations?')) return Response.json([{ id: 42, account: { login: 'ironclad', type: 'Organization', avatar_url: null } }]);
		if (c.path === '/app/installations/42/access_tokens') return Response.json({ token: 'ghs_a', expires_at: new Date(Date.now() + 3600_000).toISOString() });
		if (c.path === '/app/installations/42') return Response.json({ account: { login: 'ironclad' }, repository_selection: 'selected', permissions: { contents: 'write', metadata: 'read' } });
		if (c.path.startsWith('/installation/repositories')) return Response.json({ total_count: 1, repositories: [repo('ironclad/api')] });
		return Response.json({ message: 'Not Found' }, { status: 404 });
	});
	const [a] = await github.addGithubApp('123', pem, null);
	const r = await github.checkToken(a, 'ironclad/web');
	assert.equal(r.kind, 'GitHub App installation');
	assert.deepEqual(
		r.checks.map((c) => [c.label, c.status, c.answer]),
		[
			['The installation', 200, 'on ironclad · selected repositories only · contents: write, metadata: read'],
			['Repositories it was given', 200, '1: ironclad/api · ironclad/web is not among them'],
			['ironclad/web', 404, 'Not Found']
		]
	);
	await assert.rejects(github.lookupRepo(a, 'ironclad/web'), /installation on ironclad doesn't include ironclad\/web.*Repository access/);
	await assert.rejects(github.lookupRepo(a, 'acme/api'), /installed on ironclad, not acme/);
	gh.restore();
});

test("when GitHub turns the app down, its own reason is in the message", async () => {
	const gh = fakeGithub(() => Response.json({ message: "'Issued at' claim ('iat') must be an Integer representing a time in the past." }, { status: 401 }));
	await assert.rejects(github.addGithubApp('123', pem, null), /turned the app down\. GitHub says: “'Issued at' claim.*clock is right/);
	gh.restore();
});

test("a read-only app is labelled so, and its sessions' Claude is told not to push", async () => {
	const { githubAccess, accessNote } = await import('#lib/github-access.ts');
	const { systemPromptFor } = await import('#lib/server/sessions/runtime.ts');
	let perms: Record<string, string> = { contents: 'read', pull_requests: 'read', metadata: 'read' };
	const gh = fakeGithub((c) => {
		if (c.path === '/app') return Response.json({ slug: 'reader', name: 'Reader' });
		if (c.path.startsWith('/app/installations?')) return Response.json([{ id: 7, account: { login: 'acme', type: 'Organization', avatar_url: null } }]);
		if (c.path === '/app/installations/7/access_tokens') return Response.json({ token: 'ghs_r', expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), permissions: perms });
		return Response.json({ message: 'Not Found' }, { status: 404 });
	});
	const [a] = await github.addGithubApp('77', pem, null);
	assert.deepEqual(a.permissions, perms);
	assert.equal(githubAccess(a), 'read');

	store.setReplyStyle({ enabled: false, text: '' });
	assert.equal(systemPromptFor({ githubAccountId: a.id }), accessNote('read'));
	store.setReplyStyle({ enabled: true, text: 'Be brief.' });
	assert.equal(systemPromptFor({ githubAccountId: a.id }), `Be brief.\n\n${accessNote('read')}`);
	assert.equal(systemPromptFor({ githubAccountId: null }), 'Be brief.');

	// The owner accepts write on pull requests: renewing picks it up.
	perms = { contents: 'read', pull_requests: 'write', metadata: 'read' };
	await github.renewGithubToken(a.id);
	assert.equal(githubAccess(store.getGithubAccount(a.id)!), 'review');
	assert.match(systemPromptFor({ githubAccountId: a.id })!, /review and comment on pull requests/);
	perms = { contents: 'write', pull_requests: 'write' };
	await github.renewGithubToken(a.id);
	assert.equal(systemPromptFor({ githubAccountId: a.id }), 'Be brief.');
	// Tokens and sign-ins don't say: nothing is assumed.
	assert.equal(githubAccess({ kind: 'pat', permissions: null }), null);
	gh.restore();
});

test("a private key Orbital can't sign with fails in words, not OpenSSL's", async () => {
	const a = store.upsertGithubAccount({ login: 'x[bot]', name: 'X', avatarUrl: null, kind: 'app', token: 'ghs_x', scopes: null, orgs: [], gitName: 'x', gitEmail: 'x', expiresAt: new Date().toISOString(), renewal: { kind: 'app', appId: '9', privateKey: 'not a key', installationId: 9 } });
	await assert.rejects(github.renewGithubToken(a.id), /can't sign with this app's private key/);
	assert.match(store.getGithubAccount(a.id)!.renewError!, /can't sign/);
});

test("an app can be added by its Client ID as well as its App ID", async () => {
	const iss: string[] = [];
	const gh = fakeGithub((c) => {
		iss.push(JSON.parse(Buffer.from((c.auth ?? '').split('.')[1] ?? '', 'base64url').toString() || '{}').iss);
		if (c.path === '/app') return Response.json({ slug: 'by-client', name: 'By client ID' });
		if (c.path.startsWith('/app/installations?')) return Response.json([{ id: 8, account: { login: 'acme', type: 'Organization', avatar_url: null } }]);
		if (c.path === '/app/installations/8/access_tokens') return Response.json({ token: 'ghs_c', expires_at: new Date(Date.now() + 3600_000).toISOString() });
		return Response.json({ message: 'Not Found' }, { status: 404 });
	});
	const [a] = await github.addGithubApp('Iv23liAbCdEf123456', pem, null);
	assert.equal(a.name, 'By client ID');
	assert.equal(iss[0], 'Iv23liAbCdEf123456');
	await assert.rejects(github.addGithubApp('not-an-id', pem, null), /App ID \(a number\) or its Client ID/);
	gh.restore();
});
