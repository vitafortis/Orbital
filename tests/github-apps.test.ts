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
