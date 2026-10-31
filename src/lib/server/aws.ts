/**
 * AWS IAM Identity Center (SSO). Orbital signs in once, with a device code like GitHub's, and
 * keeps the token to itself. Sessions only ever get an AWS profile's role credentials: one
 * account, one role, valid for the role's session length (an hour by default) and renewed
 * while the session runs. The token, which could get credentials for every account and role
 * the person has, never leaves Orbital.
 *
 * Identity Center's OIDC and portal APIs are plain JSON over https with no request signing:
 * oidc.<region>.amazonaws.com (client/register, device_authorization, token) and
 * portal.sso.<region>.amazonaws.com (assignment/accounts, assignment/roles, federation/credentials).
 */
import { randomToken } from './crypto.ts';
import { BadRequest } from './http.ts';
import {
	getAwsLogin,
	getAwsLoginSecret,
	saveAwsLogin,
	setAwsLoginTokens,
	type AwsLoginSecret
} from './store.ts';
import type { AwsLogin, AwsProfile } from '#lib/types.ts';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REGION = /^[a-z]{2}(-gov|-iso[a-z]*)?-[a-z]+-\d{1,2}$/;

export function checkRegion(region: string, what = 'Region'): string {
	const r = region.trim();
	if (!REGION.test(r)) throw new BadRequest(`${what} looks like us-east-1 or eu-west-2`);
	return r;
}

/** The access portal URL, as https without a trailing slash or #/ suffix. */
export function checkStartUrl(url: string): string {
	let u: URL;
	try {
		u = new URL(url.trim());
	} catch {
		throw new BadRequest('Enter the AWS access portal URL, e.g. https://acme.awsapps.com/start');
	}
	if (u.protocol !== 'https:') throw new BadRequest('The access portal URL starts with https://');
	return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

type AwsError = { error?: string; error_description?: string; message?: string };

async function aws<T>(url: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ ok: true; data: T } | { ok: false; status: number; error: AwsError }> {
	const res = await fetch(url, {
		method: init.method ?? (init.body ? 'POST' : 'GET'),
		headers: {
			accept: 'application/json',
			...(init.body ? { 'content-type': 'application/json' } : {}),
			...(init.token ? { 'x-amz-sso_bearer_token': init.token } : {})
		},
		body: init.body ? JSON.stringify(init.body) : undefined,
		signal: AbortSignal.timeout(15_000)
	}).catch((err: unknown) => {
		const why = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
		throw new BadRequest(`Couldn't reach AWS (${why}). Check this server's network or proxy.`);
	});
	const data = (await res.json().catch(() => ({}))) as T & AwsError;
	return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: data };
}

const describe = (e: AwsError) => e.error_description || e.message || e.error || 'unknown error';

// ── signing in ─────────────────────────────────────────────────────────

type Pending = { startUrl: string; ssoRegion: string; label: string | null; clientId: string; clientSecret: string; clientExpiresAt: string | null; deviceCode: string; interval: number; expiresAt: number };
const pending = new Map<string, Pending>();

/** Starts a sign-in: returns the code to confirm and the page to confirm it on. */
export async function startAwsLogin(input: { startUrl: string; ssoRegion: string; label?: string | null }) {
	const startUrl = checkStartUrl(input.startUrl);
	const ssoRegion = checkRegion(input.ssoRegion, 'The Identity Center region');
	const base = `https://oidc.${ssoRegion}.amazonaws.com`;
	type Client = { clientId: string; clientSecret: string; clientSecretExpiresAt?: number };
	// Asking for refresh tokens lets the sign-in renew itself (up to the session length the
	// Identity Center admin set); a directory that won't issue them still signs in.
	let reg = await aws<Client>(`${base}/client/register`, {
		body: { clientName: 'Orbital', clientType: 'public', scopes: ['sso:account:access'], grantTypes: [DEVICE_GRANT, 'refresh_token'] }
	});
	if (!reg.ok && reg.status === 400) reg = await aws<Client>(`${base}/client/register`, { body: { clientName: 'Orbital', clientType: 'public' } });
	if (!reg.ok) throw new BadRequest(`AWS didn't register Orbital: ${describe(reg.error)}`);
	const { clientId, clientSecret, clientSecretExpiresAt } = reg.data;
	const dev = await aws<{ deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete?: string; expiresIn: number; interval?: number }>(
		`${base}/device_authorization`,
		{ body: { clientId, clientSecret, startUrl } }
	);
	if (!dev.ok) throw new BadRequest(`AWS didn't start the sign-in: ${describe(dev.error)} (check the portal URL and region)`);
	const handle = randomToken(16);
	const interval = dev.data.interval ?? 5;
	pending.set(handle, {
		startUrl,
		ssoRegion,
		label: input.label?.trim() || null,
		clientId,
		clientSecret,
		clientExpiresAt: clientSecretExpiresAt ? new Date(clientSecretExpiresAt * 1000).toISOString() : null,
		deviceCode: dev.data.deviceCode,
		interval,
		expiresAt: Date.now() + dev.data.expiresIn * 1000
	});
	return {
		handle,
		userCode: dev.data.userCode,
		verificationUri: dev.data.verificationUriComplete ?? dev.data.verificationUri,
		interval,
		expiresIn: dev.data.expiresIn
	};
}

type Tokens = { accessToken: string; expiresIn: number; refreshToken?: string };

/** One poll: `pending` until the person approves, then the saved sign-in. */
export async function pollAwsLogin(handle: string): Promise<{ state: 'pending' | 'done' | 'expired' | 'denied'; login?: AwsLogin; interval?: number }> {
	const p = pending.get(handle);
	if (!p || Date.now() > p.expiresAt) {
		pending.delete(handle);
		return { state: 'expired' };
	}
	const r = await aws<Tokens>(`https://oidc.${p.ssoRegion}.amazonaws.com/token`, {
		body: { clientId: p.clientId, clientSecret: p.clientSecret, grantType: DEVICE_GRANT, deviceCode: p.deviceCode }
	});
	if (r.ok) {
		pending.delete(handle);
		const login = saveAwsLogin({
			label: p.label,
			startUrl: p.startUrl,
			ssoRegion: p.ssoRegion,
			expiresAt: new Date(Date.now() + r.data.expiresIn * 1000).toISOString(),
			secret: { clientId: p.clientId, clientSecret: p.clientSecret, clientExpiresAt: p.clientExpiresAt, accessToken: r.data.accessToken, refreshToken: r.data.refreshToken ?? null }
		});
		forgetCredentials({ loginId: login.id });
		return { state: 'done', login };
	}
	const code = r.error.error;
	if (code === 'slow_down') p.interval += 5;
	if (code === 'authorization_pending' || code === 'slow_down') return { state: 'pending', interval: p.interval };
	pending.delete(handle);
	return { state: code === 'access_denied' ? 'denied' : 'expired' };
}

// ── using a sign-in ────────────────────────────────────────────────────

/** The sign-in needs a person: its token ran out and it can't renew itself. */
export class SignInAgain extends BadRequest {}

const renewing = new Map<string, Promise<string>>();

/** A current access token for the sign-in, renewed with its refresh token when it can be. */
async function accessToken(loginId: string): Promise<string> {
	const login = getAwsLogin(loginId);
	if (!login) throw new BadRequest('That AWS sign-in no longer exists');
	const again = `The AWS sign-in to ${login.label ?? login.startUrl} has ended: sign in again under Accounts → AWS.`;
	let secret: AwsLoginSecret | undefined;
	try {
		secret = getAwsLoginSecret(loginId);
	} catch {
		// Sealed with another secret key (a restored backup, a new ORB_SECRET_KEY).
		throw new SignInAgain(`Orbital can't read its saved AWS sign-in to ${login.label ?? login.startUrl}: sign in again under Accounts → AWS.`);
	}
	if (!secret) throw new BadRequest('That AWS sign-in no longer exists');
	if (login.expiresAt && Date.parse(login.expiresAt) > Date.now() + 120_000) return secret.accessToken;
	if (!secret.refreshToken) throw new SignInAgain(again);
	const current = secret;
	let p = renewing.get(loginId);
	if (!p) {
		p = (async () => {
			const r = await aws<Tokens>(`https://oidc.${login.ssoRegion}.amazonaws.com/token`, {
				body: { clientId: current.clientId, clientSecret: current.clientSecret, grantType: 'refresh_token', refreshToken: current.refreshToken }
			});
			if (!r.ok) throw new SignInAgain(again);
			const next: AwsLoginSecret = { ...current, accessToken: r.data.accessToken, refreshToken: r.data.refreshToken ?? current.refreshToken };
			setAwsLoginTokens(loginId, next, new Date(Date.now() + r.data.expiresIn * 1000).toISOString());
			return next.accessToken;
		})().finally(() => renewing.delete(loginId));
		renewing.set(loginId, p);
	}
	return p;
}

async function portal<T>(loginId: string, path: string): Promise<T> {
	const login = getAwsLogin(loginId);
	if (!login) throw new BadRequest('That AWS sign-in no longer exists');
	const r = await aws<T>(`https://portal.sso.${login.ssoRegion}.amazonaws.com${path}`, { token: await accessToken(loginId) });
	if (r.ok) return r.data;
	if (r.status === 401) throw new SignInAgain(`AWS no longer accepts the sign-in to ${login.label ?? login.startUrl}: sign in again under Accounts → AWS.`);
	throw new BadRequest(`AWS: ${describe(r.error)}`);
}

/** The accounts the sign-in can reach, by name. */
export async function listAwsAccounts(loginId: string): Promise<{ accountId: string; accountName: string | null; email: string | null }[]> {
	const out: { accountId: string; accountName: string | null; email: string | null }[] = [];
	let next: string | undefined;
	do {
		const q = new URLSearchParams({ max_result: '100', ...(next ? { next_token: next } : {}) });
		const page = await portal<{ accountList?: { accountId: string; accountName?: string; emailAddress?: string }[]; nextToken?: string }>(loginId, `/assignment/accounts?${q}`);
		for (const a of page.accountList ?? []) out.push({ accountId: a.accountId, accountName: a.accountName ?? null, email: a.emailAddress ?? null });
		next = page.nextToken;
	} while (next && out.length < 2000);
	return out.sort((a, b) => (a.accountName ?? a.accountId).localeCompare(b.accountName ?? b.accountId));
}

/** The roles (permission sets) the sign-in has in an account. */
export async function listAwsRoles(loginId: string, accountId: string): Promise<string[]> {
	if (!/^\d{12}$/.test(accountId)) throw new BadRequest('An AWS account id is 12 digits');
	const out: string[] = [];
	let next: string | undefined;
	do {
		const q = new URLSearchParams({ account_id: accountId, max_result: '100', ...(next ? { next_token: next } : {}) });
		const page = await portal<{ roleList?: { roleName: string }[]; nextToken?: string }>(loginId, `/assignment/roles?${q}`);
		out.push(...(page.roleList ?? []).map((r) => r.roleName));
		next = page.nextToken;
	} while (next && out.length < 500);
	return out.sort();
}

export type RoleCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiresAt: number };

// Credentials are reused until 10 minutes before they expire: sessions sharing a profile get
// the same ones, and AWS isn't asked on every poll.
const credCache = new Map<string, RoleCredentials & { loginId: string }>();
const RENEW_BEFORE = 10 * 60_000;

/** Forgets cached credentials, after a profile or sign-in changes or goes. */
export function forgetCredentials(which: { profileId?: string; loginId?: string }) {
	for (const [id, c] of credCache) if (id === which.profileId || c.loginId === which.loginId) credCache.delete(id);
}

/** Short-lived credentials for the profile's account and role. */
export async function profileCredentials(profile: AwsProfile): Promise<RoleCredentials> {
	const hit = credCache.get(profile.id);
	if (hit && hit.expiresAt - RENEW_BEFORE > Date.now()) return hit;
	const q = new URLSearchParams({ account_id: profile.accountId, role_name: profile.roleName });
	const { roleCredentials: c } = await portal<{ roleCredentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: number } }>(
		profile.loginId,
		`/federation/credentials?${q}`
	);
	const creds = { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, sessionToken: c.sessionToken, expiresAt: c.expiration, loginId: profile.loginId };
	credCache.set(profile.id, creds);
	return creds;
}

/** Whether a cached credential is due for renewal (or there is none yet). */
export function credentialsDue(profileId: string): boolean {
	const hit = credCache.get(profileId);
	return !hit || hit.expiresAt - RENEW_BEFORE <= Date.now();
}
