/**
 * OpenID Connect sign-in (Authentik, Authelia, Keycloak, Pocket ID, Zitadel, Google, Entra…):
 * the authorization code flow with PKCE. The ID token comes straight from the provider's
 * token endpoint over TLS, which OpenID Connect Core (3.1.3.7) accepts in place of checking
 * its signature; its issuer, audience, expiry and nonce are still checked.
 */
import { createHash } from 'node:crypto';
import { accessFor, getAuthSettings, oidcClientSecret, whyRole } from './auth-config.ts';
import { randomToken } from './crypto.ts';
import { BadRequest } from './http.ts';
import { findUserBySsoSubject, getUser, linkSso, upsertExternalUser } from './store.ts';
import type { User } from '#lib/types.ts';

type Discovery = {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	userinfo_endpoint?: string;
	end_session_endpoint?: string;
	token_endpoint_auth_methods_supported?: string[];
};

const discoveries = new Map<string, { at: number; doc: Discovery }>();

export async function discover(issuer: string, fresh = false): Promise<Discovery> {
	const base = issuer.trim().replace(/\/+$/, '');
	const hit = discoveries.get(base);
	if (!fresh && hit && Date.now() - hit.at < 10 * 60_000) return hit.doc;
	let res: Response;
	try {
		res = await fetch(`${base}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
	} catch (err) {
		throw new BadRequest(`Couldn't reach ${base}: ${err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : err}`);
	}
	if (!res.ok) throw new BadRequest(`${base}/.well-known/openid-configuration answered HTTP ${res.status}`);
	const doc = (await res.json().catch(() => null)) as Discovery | null;
	if (!doc?.authorization_endpoint || !doc.token_endpoint || !doc.issuer) throw new BadRequest("That isn't an OpenID Connect issuer (no discovery document)");
	discoveries.set(base, { at: Date.now(), doc });
	return doc;
}

/** Where the provider sends people back; register it with the provider. */
export const callbackUrl = (base: string) => `${base.replace(/\/+$/, '')}/api/auth/oidc/callback`;

/** `link`: a signed-in user linking their SSO identity to their Orbital user, not signing in. */
type Pending = { verifier: string; nonce: string; redirectUri: string; next: string; expires: number; link: string | null };
const pending = new Map<string, Pending>();

/** Holds the sign-in's state, binding the callback to the browser that started it. */
export const STATE_COOKIE = 'orb_oidc';

const b64url = (b: Buffer) => b.toString('base64url');

/** The provider's sign-in URL; `state` also goes in a cookie so only this browser can finish. */
export async function startSignIn(base: string, next: string, link: string | null = null): Promise<{ url: string; state: string }> {
	const s = getAuthSettings();
	if (!s.oidc.enabled || !s.oidc.issuer || !s.oidc.clientId) throw new BadRequest('Single sign-on is not set up');
	const doc = await discover(s.oidc.issuer);
	const now = Date.now();
	for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
	const state = randomToken(24);
	const verifier = randomToken(48);
	const nonce = randomToken(24);
	const redirectUri = callbackUrl(base);
	pending.set(state, { verifier, nonce, redirectUri, next, expires: now + 10 * 60_000, link });
	const url = new URL(doc.authorization_endpoint);
	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: s.oidc.clientId,
		redirect_uri: redirectUri,
		scope: s.oidc.scopes || 'openid email profile',
		state,
		nonce,
		code_challenge: b64url(createHash('sha256').update(verifier).digest()),
		code_challenge_method: 'S256'
	}).toString();
	return { url: url.toString(), state };
}

function decodeJwt(token: string): Record<string, unknown> {
	const part = token.split('.')[1];
	if (!part) throw new BadRequest('The provider sent a malformed ID token');
	return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function claimList(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
	if (typeof v === 'string') return v.split(/[,\s]+/).filter(Boolean);
	return [];
}

/** Reads a claim by name, allowing dotted paths ("realm_access.roles" in Keycloak). */
function claim(obj: Record<string, unknown>, path: string): unknown {
	return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/**
 * Finishes the sign-in: exchanges the code, checks the ID token, applies the access rules. When
 * it was started to link SSO to `signedIn`'s user, links the identity instead (`linked`).
 */
export async function finishSignIn(params: URLSearchParams, cookieState: string | undefined, signedIn: string | null = null): Promise<{ user: User; next: string; linked?: boolean }> {
	const err = params.get('error');
	if (err) throw new BadRequest(`The provider said: ${params.get('error_description') || err}`);
	const state = params.get('state') ?? '';
	const p = pending.get(state);
	pending.delete(state);
	if (!p || !cookieState || cookieState !== state || p.expires < Date.now()) throw new BadRequest('This sign-in expired or was started in another browser. Try again.');
	const code = params.get('code');
	if (!code) throw new BadRequest('The provider sent no code');

	const s = getAuthSettings();
	const doc = await discover(s.oidc.issuer);
	const secret = oidcClientSecret();
	const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, code_verifier: p.verifier, client_id: s.oidc.clientId });
	const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
	if (secret) {
		// client_secret_basic unless the provider only takes client_secret_post.
		const methods = doc.token_endpoint_auth_methods_supported;
		if (methods && !methods.includes('client_secret_basic') && methods.includes('client_secret_post')) form.set('client_secret', secret);
		else headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(s.oidc.clientId)}:${encodeURIComponent(secret)}`).toString('base64')}`;
	}
	const res = await fetch(doc.token_endpoint, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(15_000) });
	const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; access_token?: string; error?: string; error_description?: string };
	if (!res.ok || !tokens.id_token) throw new BadRequest(`The provider refused the sign-in: ${tokens.error_description || tokens.error || `HTTP ${res.status}`}`);

	const id = decodeJwt(tokens.id_token);
	const aud = claimList(id.aud);
	if (id.iss !== doc.issuer) throw new BadRequest('The ID token is from another issuer');
	if (!aud.includes(s.oidc.clientId)) throw new BadRequest('The ID token is for another client');
	if (typeof id.exp !== 'number' || id.exp * 1000 < Date.now() - 60_000) throw new BadRequest('The ID token has expired');
	if (id.nonce !== p.nonce) throw new BadRequest('The ID token does not match this sign-in');

	// Some providers keep email and groups out of the ID token; the ID token wins where both say.
	let info: Record<string, unknown> = {};
	if ((!id.email || claim(id, s.oidc.groupsClaim) === undefined) && doc.userinfo_endpoint && tokens.access_token) {
		const r = await fetch(doc.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
		const body = r.ok ? ((await r.json().catch(() => ({}))) as Record<string, unknown>) : {};
		if (body.sub === id.sub) info = body;
	}
	const claims = { ...info, ...id };
	// Who this is at the provider, whatever their email: the link to an Orbital user.
	const subject = `${doc.issuer}#${String(id.sub)}`;
	if (p.link) {
		if (p.link !== signedIn) throw new BadRequest('Sign in to Orbital as yourself first, then link single sign-on from your profile.');
		const other = findUserBySsoSubject(subject);
		if (other && other.id !== p.link) throw new BadRequest(`That single sign-on account is already linked to ${other.email} in Orbital.`);
		linkSso(p.link, subject);
		return { user: getUser(p.link)!, next: p.next, linked: true };
	}
	const email = typeof claims.email === 'string' ? claims.email : null;
	if (!email) throw new BadRequest('The provider sent no email address. Add the "email" scope, or map an email claim.');
	if (claims.email_verified === false) throw new BadRequest(`${email} is not verified with the provider`);
	const groups = claimList(claim(id, s.oidc.groupsClaim) ?? claim(info, s.oidc.groupsClaim));
	const { allowed, role } = accessFor(s.access, email, groups);
	if (!allowed) throw new BadRequest(`${email} isn't allowed to sign in to Orbital. An admin can allow it under Settings → Sign-in.`);
	const name = typeof claims.name === 'string' ? claims.name : typeof claims.preferred_username === 'string' ? claims.preferred_username : null;
	return { user: upsertExternalUser({ email, name, source: 'oidc', role, rule: whyRole(s.access, email, groups), subject }), next: p.next };
}
