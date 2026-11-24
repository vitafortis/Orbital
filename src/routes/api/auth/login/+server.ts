import { json } from '@sveltejs/kit';
import { startSession, throttled } from '#lib/server/auth.ts';
import { getAuthSettings } from '#lib/server/auth-config.ts';
import { hashPassword, verifyPassword } from '#lib/server/crypto.ts';
import { findUserByEmail, getPasswordHash } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

// Verified against when the user doesn't exist, so timing doesn't reveal valid emails.
const DUMMY_HASH = hashPassword('orbital-dummy-password');

export const POST: RequestHandler = async ({ request, cookies, locals, getClientAddress }) => {
	if (throttled(getClientAddress())) return json({ message: 'Too many attempts — wait a few minutes' }, { status: 429 });
	const { email, password } = await request.json().catch(() => ({}));
	if (typeof email !== 'string' || typeof password !== 'string') return json({ message: 'Incorrect email or password' }, { status: 401 });
	const user = findUserByEmail(email);
	const hash = user ? getPasswordHash(user.id) : undefined;
	const ok = verifyPassword(password, hash ?? DUMMY_HASH) && !!hash;
	if (!user || !ok) return json({ message: 'Incorrect email or password' }, { status: 401 });
	// Single sign-on only: passwords are the admins' way in when SSO is down, nobody else's.
	const s = getAuthSettings();
	if (!s.passwordForm && (s.oidc.enabled || s.proxy.enabled) && user.baseRole !== 'admin') {
		return json({ message: 'Orbital signs people in through single sign-on: use the button on the sign-in page.' }, { status: 403 });
	}
	startSession(cookies, user.id, locals.secure);
	return json({ ok: true });
};
