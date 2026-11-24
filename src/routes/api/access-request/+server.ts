import { json } from '@sveltejs/kit';
import { BadRequest, body, handler } from '#lib/server/http.ts';
import { deleteAccessRequest, requestAccess } from '#lib/server/store.ts';
import type { UserRole } from '#lib/types.ts';
import type { RequestHandler } from './$types';

const RANK: Record<UserRole, number> = { viewer: 0, member: 1, admin: 2 };

/** Asks the admins for more access: it shows in their To do and under Sign-in & users. */
export const POST: RequestHandler = handler(async ({ locals, request }) => {
	const u = locals.user;
	if (!u || u.id === 'open') throw new BadRequest('Sign-in is off: everyone is an admin');
	const b = await body(request);
	const role = b.role as UserRole;
	if (role !== 'member' && role !== 'admin') throw new BadRequest('Ask for member or admin');
	if (RANK[role] <= RANK[u.role]) throw new BadRequest(`You're already ${u.role === 'admin' ? 'an admin' : 'a member'}`);
	const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) || null : null;
	requestAccess(u.id, role, note);
	return json({ ok: true });
});

/** Takes your request back. */
export const DELETE: RequestHandler = handler(({ locals }) => {
	if (locals.user) deleteAccessRequest(locals.user.id);
	return json({ ok: true });
});
