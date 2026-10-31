import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The store opens its database on first use, under ORB_DATA_DIR.
const dataDir = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_DATA_DIR = dataDir;
process.env.ORB_SESSIONS_DIR = join(dataDir, 'sessions');
process.env.ORB_SECRET_KEY = 'test-key';
const store = await import('#lib/server/store.ts');
const aws = await import('#lib/server/aws.ts');
const { writeAwsCredentials, sessionAws, AWS_ENV } = await import('#lib/server/sessions/aws.ts');
const { metaDir } = await import('#lib/server/sessions/storage.ts');

// AWS Identity Center, faked: what Orbital asks, and the answers it gets.
type Call = { path: string; body: Record<string, unknown> | null; token: string | null };
const calls: Call[] = [];
let tokenAnswers: Response[] = [];
let credsIssued = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(String(input));
	const body = init?.body ? JSON.parse(String(init.body)) : null;
	const token = new Headers(init?.headers).get('x-amz-sso_bearer_token');
	calls.push({ path: `${url.host}${url.pathname}`, body, token });
	if (url.pathname === '/client/register') return Response.json({ clientId: 'cid', clientSecret: 'csecret', clientSecretExpiresAt: 2_000_000_000 });
	if (url.pathname === '/device_authorization')
		return Response.json({ deviceCode: 'dev', userCode: 'ABCD-EFGH', verificationUri: 'https://device.sso.us-east-1.amazonaws.com/', verificationUriComplete: 'https://device.sso.us-east-1.amazonaws.com/?user_code=ABCD-EFGH', expiresIn: 600, interval: 1 });
	if (url.pathname === '/token') return tokenAnswers.shift() ?? new Response('{}', { status: 500 });
	if (url.pathname === '/assignment/accounts') return Response.json({ accountList: [{ accountId: '111111111111', accountName: 'prod' }, { accountId: '222222222222', accountName: 'sandbox' }] });
	if (url.pathname === '/assignment/roles') return Response.json({ roleList: [{ roleName: 'ReadOnly' }, { roleName: 'Admin' }] });
	if (url.pathname === '/federation/credentials') {
		credsIssued++;
		return Response.json({ roleCredentials: { accessKeyId: `AKIA${credsIssued}`, secretAccessKey: 'secret', sessionToken: 'session', expiration: Date.now() + 3600_000 } });
	}
	return new Response('{}', { status: 404 });
}) as typeof fetch;

test('signing in to AWS SSO: device code, then the token stays on the server, encrypted', async () => {
	const start = await aws.startAwsLogin({ startUrl: 'https://acme.awsapps.com/start/#/', ssoRegion: 'us-east-1', label: 'Acme' });
	assert.equal(start.userCode, 'ABCD-EFGH');
	assert.match(start.verificationUri, /user_code=ABCD-EFGH/);
	// The client asks for refresh tokens, so the sign-in can renew itself.
	assert.deepEqual(calls[0].body?.grantTypes, ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']);
	assert.equal(calls[1].body?.startUrl, 'https://acme.awsapps.com/start');

	tokenAnswers = [Response.json({ error: 'authorization_pending' }, { status: 400 }), Response.json({ accessToken: 'sso-token', expiresIn: 28800, refreshToken: 'refresh-1' })];
	assert.equal((await aws.pollAwsLogin(start.handle)).state, 'pending');
	const done = await aws.pollAwsLogin(start.handle);
	assert.equal(done.state, 'done');
	assert.equal(done.login?.label, 'Acme');
	assert.equal(done.login?.renewable, true);
	assert.ok(!JSON.stringify(store.listAwsLogins()).includes('sso-token'), 'tokens are not part of what the API lists');
	assert.equal(store.getAwsLoginSecret(done.login!.id)?.accessToken, 'sso-token');
});

test('accounts, roles, and a profile whose session gets only that role, as AWS files', async () => {
	const login = store.listAwsLogins()[0];
	assert.deepEqual((await aws.listAwsAccounts(login.id)).map((a) => a.accountName), ['prod', 'sandbox']);
	assert.deepEqual(await aws.listAwsRoles(login.id, '111111111111'), ['Admin', 'ReadOnly']);
	assert.equal(calls.at(-1)?.token, 'sso-token');

	const profile = store.createAwsProfile({ name: 'prod-readonly', loginId: login.id, accountId: '111111111111', accountName: 'prod', roleName: 'ReadOnly', region: 'eu-west-1' });
	const session = { id: 'sess-1', awsProfileIds: [profile.id] };
	mkdirSync(metaDir(session.id), { recursive: true });
	await writeAwsCredentials(session);
	const dir = join(metaDir(session.id), 'aws');
	const creds = readFileSync(join(dir, 'credentials'), 'utf8');
	assert.match(creds, /\[default\]\naws_access_key_id = AKIA1\n/);
	assert.match(creds, /\[prod-readonly\]\naws_access_key_id = AKIA1\n/);
	assert.ok(!creds.includes('sso-token'), 'the SSO token never reaches a session');
	assert.match(readFileSync(join(dir, 'config'), 'utf8'), /\[profile prod-readonly\]\nregion = eu-west-1/);
	assert.equal(statSync(join(dir, 'credentials')).mode & 0o777, 0o600);
	assert.equal(sessionAws(session.id)[0].error, null);
	assert.deepEqual(AWS_ENV, ['AWS_SHARED_CREDENTIALS_FILE=/session/.orb/aws/credentials', 'AWS_CONFIG_FILE=/session/.orb/aws/config']);

	// Credentials are reused until they're near expiry: a second write asks AWS for nothing new.
	await writeAwsCredentials(session);
	assert.equal(credsIssued, 1);

	// Stopping (or removing the profile) takes the files away.
	await writeAwsCredentials(session, { remove: true });
	assert.ok(!existsSync(dir));
});

test('an expired sign-in renews with its refresh token, or asks to sign in again', async () => {
	const login = store.listAwsLogins()[0];
	const secret = store.getAwsLoginSecret(login.id)!;
	store.setAwsLoginTokens(login.id, secret, new Date(Date.now() - 1000).toISOString());
	tokenAnswers = [Response.json({ accessToken: 'sso-token-2', expiresIn: 28800, refreshToken: 'refresh-2' })];
	await aws.listAwsAccounts(login.id);
	assert.equal(calls.find((c) => c.body?.grantType === 'refresh_token')?.body?.refreshToken, 'refresh-1');
	assert.equal(store.getAwsLoginSecret(login.id)?.accessToken, 'sso-token-2');
	assert.ok(Date.parse(store.getAwsLogin(login.id)!.expiresAt!) > Date.now());

	store.setAwsLoginTokens(login.id, { ...secret, refreshToken: null }, new Date(Date.now() - 1000).toISOString());
	await assert.rejects(aws.listAwsAccounts(login.id), /sign in again/);
});

test('portal URLs and regions are checked', () => {
	assert.equal(aws.checkStartUrl('https://d-123.awsapps.com/start/'), 'https://d-123.awsapps.com/start');
	assert.throws(() => aws.checkStartUrl('http://acme.awsapps.com/start'), /https/);
	assert.equal(aws.checkRegion('us-gov-west-1'), 'us-gov-west-1');
	assert.throws(() => aws.checkRegion('us-east'), /us-east-1/);
});
