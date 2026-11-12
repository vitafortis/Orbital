/**
 * "Connect my Notion": a person signs in to Notion's hosted MCP server (mcp.notion.com) through
 * OAuth, and the sessions they start reach Notion as them. Orbital is the OAuth client (a public
 * one, registered with Notion on first use, with PKCE), so the sign-in returns to Orbital's own
 * address rather than to localhost inside a container, which Claude Code's own flow would need.
 * Tokens are kept encrypted per person and renewed before they run out.
 */
import { createHash, randomBytes } from 'node:crypto';
import { BadRequest } from './http.ts';
import { deleteNotionConnection, getKv, getNotionConnection, getNotionSecret, listNotionConnections, saveNotionConnection, setKv, setNotionRenewError } from './store.ts';

export const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';
const ISSUER = 'https://mcp.notion.com';

type Metadata = { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string; revocation_endpoint?: string };
let metadata: Metadata | null = null;

async function call(url: string, init: RequestInit): Promise<Response> {
	return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }).catch((err: unknown) => {
		throw new BadRequest(`Couldn't reach Notion (${err instanceof Error ? err.message : err}). Check this server's network.`);
	});
}

/** Notion's OAuth endpoints, as it publishes them. */
async function endpoints(): Promise<Metadata> {
	if (metadata) return metadata;
	const res = await call(`${ISSUER}/.well-known/oauth-authorization-server`, { headers: { accept: 'application/json' } });
	if (!res.ok) throw new BadRequest(`Notion's sign-in isn't available right now (${res.status}).`);
	metadata = (await res.json()) as Metadata;
	return metadata;
}

/** Orbital's client ID with Notion for this return address, registered the first time it's used. */
async function clientFor(redirectUri: string): Promise<string> {
	const known = getKv<Record<string, string>>('notionClients', {});
	if (known[redirectUri]) return known[redirectUri];
	const res = await call((await endpoints()).registration_endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({
			client_name: 'Orbital',
			redirect_uris: [redirectUri],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none'
		})
	});
	const b = (await res.json().catch(() => ({}))) as { client_id?: string; error_description?: string; error?: string };
	if (!res.ok || !b.client_id) throw new BadRequest(`Notion didn't register Orbital: ${b.error_description ?? b.error ?? res.statusText}`);
	setKv('notionClients', { ...known, [redirectUri]: b.client_id });
	return b.client_id;
}

const b64url = (b: Buffer) => b.toString('base64url');
type Pending = { userId: string; verifier: string; redirectUri: string; clientId: string; at: number };
const pending = new Map<string, Pending>();

/** Where to send the person's browser to sign in to Notion; it comes back to `origin`. */
export async function startNotionConnect(userId: string, origin: string): Promise<string> {
	const redirectUri = `${origin.replace(/\/+$/, '')}/api/notion/callback`;
	const [{ authorization_endpoint }, clientId] = await Promise.all([endpoints(), clientFor(redirectUri)]);
	const verifier = b64url(randomBytes(32));
	const state = b64url(randomBytes(16));
	for (const [k, p] of pending) if (Date.now() - p.at > 15 * 60_000) pending.delete(k);
	pending.set(state, { userId, verifier, redirectUri, clientId, at: Date.now() });
	const q = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: redirectUri,
		code_challenge: b64url(createHash('sha256').update(verifier).digest()),
		code_challenge_method: 'S256',
		state,
		scope: 'default',
		resource: NOTION_MCP_URL
	});
	return `${authorization_endpoint}?${q}`;
}

type TokenAnswer = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

async function token(form: Record<string, string>): Promise<TokenAnswer & { access_token: string }> {
	const res = await call((await endpoints()).token_endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
		body: new URLSearchParams({ ...form, resource: NOTION_MCP_URL })
	});
	const b = (await res.json().catch(() => ({}))) as TokenAnswer;
	if (!res.ok || !b.access_token) throw new BadRequest(`Notion: ${b.error_description ?? b.error ?? res.statusText}`);
	return b as TokenAnswer & { access_token: string };
}

const expiry = (s: number | undefined) => (s ? new Date(Date.now() + s * 1000).toISOString() : null);

/**
 * Back from Notion: the code for tokens, saved for whoever started the sign-in, which has to be
 * who's signed in to Orbital now. Their user id.
 */
export async function finishNotionConnect(state: string, code: string, userId: string | null): Promise<string> {
	const p = pending.get(state);
	pending.delete(state);
	if (!p || Date.now() - p.at > 15 * 60_000) throw new BadRequest('That Notion sign-in expired. Connect again.');
	if (p.userId !== userId) throw new BadRequest('This Notion sign-in was started by someone else. Connect again.');
	const t = await token({ grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, client_id: p.clientId, code_verifier: p.verifier });
	saveNotionConnection(p.userId, { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, clientId: p.clientId }, expiry(t.expires_in));
	return p.userId;
}

/** A new access token with the refresh token (Notion may hand out a new refresh token too). */
export async function renewNotionToken(userId: string): Promise<void> {
	const s = getNotionSecret(userId);
	if (!s?.refreshToken) {
		setNotionRenewError(userId, 'This sign-in can’t renew itself: connect Notion again.');
		return;
	}
	try {
		const t = await token({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId });
		saveNotionConnection(userId, { ...s, accessToken: t.access_token, refreshToken: t.refresh_token ?? s.refreshToken }, expiry(t.expires_in));
	} catch (err) {
		setNotionRenewError(userId, `${err instanceof Error ? err.message : err} Connect Notion again.`);
		throw err;
	}
}

const RENEW_BEFORE = 10 * 60_000;
const lastTry = new Map<string, number>();

/** Renews sign-ins about to run out (from the live poll); returns whose token changed. */
export async function renewNotionTokens(now = Date.now()): Promise<string[]> {
	const renewed: string[] = [];
	for (const c of listNotionConnections()) {
		if (!c.expiresAt || Date.parse(c.expiresAt) - now > RENEW_BEFORE) continue;
		if (now - (lastTry.get(c.userId) ?? 0) < (c.renewError ? 5 * 60_000 : 30_000)) continue;
		lastTry.set(c.userId, now);
		await renewNotionToken(c.userId).then(
			() => renewed.push(c.userId),
			(err) => console.error('[orbital] renewing a Notion sign-in:', err instanceof Error ? err.message : err)
		);
	}
	return renewed;
}

/** Forgets the person's sign-in, and asks Notion to revoke it. */
export async function disconnectNotion(userId: string): Promise<void> {
	const s = getNotionSecret(userId);
	deleteNotionConnection(userId);
	const revoke = metadata?.revocation_endpoint ?? `${ISSUER}/token`;
	if (s?.refreshToken) {
		await call(revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: s.refreshToken, token_type_hint: 'refresh_token', client_id: s.clientId }) }).catch(() => {});
	}
}

/** The access token sessions use, or null when the person hasn't connected Notion. */
export function notionAccessToken(userId: string | null): string | null {
	if (!userId || !getNotionConnection(userId)) return null;
	return getNotionSecret(userId)?.accessToken ?? null;
}
