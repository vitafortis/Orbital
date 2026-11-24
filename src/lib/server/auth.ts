import type { Cookies } from '@sveltejs/kit';
import { accessFor, getAuthSettings, signInRequired, whyRole } from './auth-config.ts';
import { config } from './config.ts';
import { ipMatches } from './net.ts';
import { hashPassword, randomToken, sha256 } from './crypto.ts';
import { authSessionUser, countUsers, createAuthSession, createUser, deleteAuthSession, touchUserLogin, upsertExternalUser } from './store.ts';
import type { User } from '#lib/types.ts';

export const SESSION_COOKIE = 'orb_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthState = 'disabled' | 'setup' | 'anonymous' | 'authenticated';

/** Stand-in user when sign-in is off. */
const OPEN_USER: User = { id: 'open', email: 'admin', name: 'Admin', role: 'admin', baseRole: 'admin', rolePinned: false, roleRule: null, tempRole: null, tempUntil: null, source: 'local', createdAt: new Date(0).toISOString(), lastLoginAt: null };

let bootstrapped = false;

/** ORB_ADMIN_EMAIL + ORB_ADMIN_PASSWORD create the first account, so headless installs skip setup. */
function bootstrapAdmin() {
	bootstrapped = true;
	const b = config.bootstrapAdmin;
	if (!b || countUsers() > 0) return;
	if (b.password.length < 8) {
		console.warn('[orbital] ORB_ADMIN_PASSWORD must be at least 8 characters; showing the setup wizard instead.');
		return;
	}
	createUser({ email: b.email, name: b.name, passwordHash: hashPassword(b.password) });
	console.log(`[orbital] Created account ${b.email} from ORB_ADMIN_EMAIL.`);
}

/** Resolves the signed-in user from the session cookie's value. */
export function authenticateToken(token: string | undefined): { state: AuthState; user: User | null } {
	if (config.authDisabled) return { state: 'disabled', user: OPEN_USER };
	if (!bootstrapped) bootstrapAdmin();
	// The local admin comes first, even when sign-in will be off: it owns the settings.
	if (countUsers() === 0) return { state: 'setup', user: null };
	if (!signInRequired()) return { state: 'disabled', user: OPEN_USER };
	const user = token ? authSessionUser(sha256(token)) : undefined;
	return user ? { state: 'authenticated', user } : { state: 'anonymous', user: null };
}

export function authenticate(cookies: Cookies) {
	return authenticateToken(cookies.get(SESSION_COOKIE));
}

/** Reads the session cookie from a raw Cookie header (WebSocket upgrades have no Cookies API). */
export function sessionTokenFromHeader(header: string | undefined): string | undefined {
	for (const part of (header ?? '').split(';')) {
		const [k, ...v] = part.trim().split('=');
		if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='));
	}
	return undefined;
}

export function startSession(cookies: Cookies, userId: string, secure: boolean) {
	const token = randomToken();
	createAuthSession(sha256(token), userId, SESSION_TTL_MS);
	touchUserLogin(userId);
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		// Cross-site writes are blocked by the Origin check in hooks.server.ts.
		sameSite: 'lax',
		secure,
		maxAge: SESSION_TTL_MS / 1000
	});
}

export function endSession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) deleteAuthSession(sha256(token));
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

// Simple in-memory login throttle: 10 attempts per 5 minutes per client address.
const attempts = new Map<string, number[]>();
export function throttled(key: string): boolean {
	const now = Date.now();
	const recent = (attempts.get(key) ?? []).filter((t) => now - t < 5 * 60_000);
	recent.push(now);
	attempts.set(key, recent);
	return recent.length > 10;
}

/**
 * Forward auth: a trusted reverse proxy signed the person in and says who it is in headers.
 * Returns the user to sign in as, or null when the request doesn't carry a usable identity.
 * Headers from anywhere else are ignored, or anyone could claim to be anyone.
 */
export function proxyIdentity(headers: Headers, clientAddress: string | undefined): { user: User } | { denied: string } | null {
	const s = getAuthSettings();
	if (!s.proxy.enabled || !clientAddress || !ipMatches(clientAddress, s.proxy.trustedProxies)) return null;
	const email = headers.get(s.proxy.emailHeader)?.trim();
	if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
	const groups = (s.proxy.groupsHeader && headers.get(s.proxy.groupsHeader)?.split(/[,|]/).map((g) => g.trim()).filter(Boolean)) || [];
	const { allowed, role } = accessFor(s.access, email, groups);
	if (!allowed) return { denied: `${email} isn't allowed to sign in to Orbital` };
	const name = (s.proxy.nameHeader && headers.get(s.proxy.nameHeader)?.trim()) || null;
	return { user: upsertExternalUser({ email, name, source: 'proxy', role, rule: whyRole(s.access, email, groups) }) };
}
