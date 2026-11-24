import { json } from '@sveltejs/kit';
import { SESSION_COOKIE } from '#lib/server/auth.ts';
import { hashPassword, sha256, verifyPassword } from '#lib/server/crypto.ts';
import { BadRequest, body, handler } from '#lib/server/http.ts';
import { deleteUserAuthSessions, findUserByEmail, getPasswordHash, linkSso, updateUser } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lets the signed-in user change their name, email and password (setting a first one needs no
 * current one), and unlink single sign-on when they have a password to sign in with instead.
 */
export const PUT: RequestHandler = handler(async ({ request, locals, cookies }) => {
	const user = locals.user;
	if (!user || user.id === 'open') throw new BadRequest('Accounts are disabled (ORB_AUTH=disabled)');
	const b = await body(request);
	const patch: Parameters<typeof updateUser>[1] = {};
	if (typeof b.name === 'string') patch.name = b.name.trim() || null;
	if (typeof b.email === 'string' && b.email.trim() !== user.email) {
		// Linked to single sign-on: the provider's email wins at every sign-in.
		if (user.ssoLinked) throw new BadRequest('Your email comes from single sign-on: change it there, and Orbital follows at your next sign-in');
		const email = b.email.trim();
		if (!EMAIL.test(email)) throw new BadRequest('Enter a valid email address');
		const taken = findUserByEmail(email);
		if (taken && taken.id !== user.id) throw new BadRequest(`${email} is already used by another account`);
		patch.email = email;
	}
	if (typeof b.newPassword === 'string' && b.newPassword) {
		if (b.newPassword.length < 8) throw new BadRequest('Use at least 8 characters for the new password');
		const current = getPasswordHash(user.id);
		if (current && !(typeof b.currentPassword === 'string' && verifyPassword(b.currentPassword, current))) {
			throw new BadRequest('Current password is incorrect');
		}
		patch.passwordHash = hashPassword(b.newPassword);
		// Sign out everywhere else.
		const token = cookies.get(SESSION_COOKIE);
		deleteUserAuthSessions(user.id, token ? sha256(token) : undefined);
	}
	if (b.unlinkSso === true && user.ssoLinked) {
		if (!user.hasPassword && !patch.passwordHash) throw new BadRequest('Set a password first, or you would have no way to sign in');
		linkSso(user.id, null);
	}
	updateUser(user.id, patch);
	return json({ ok: true });
});
