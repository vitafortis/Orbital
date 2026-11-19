import { json } from '@sveltejs/kit';
import { BadRequest, body, Conflict, handler, NotFound, requireAdmin } from '#lib/server/http.ts';
import { countAdmins, deleteUser, getUser, setUserRole } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

function load(id: string) {
	const u = getUser(id);
	if (!u) throw new NotFound('User not found');
	return u;
}

/** Makes someone an admin or a member. There is always at least one admin. */
export const PATCH: RequestHandler = handler(async ({ locals, params, request }) => {
	requireAdmin(locals);
	const u = load(params.id);
	const role = (await body(request)).role;
	if (role !== 'admin' && role !== 'member' && role !== 'viewer') throw new BadRequest('Role must be admin, member or viewer');
	if (u.role === 'admin' && role !== 'admin' && countAdmins() <= 1) throw new Conflict('Keep at least one admin');
	setUserRole(u.id, role);
	return json(getUser(u.id));
});

/** Removes someone and signs them out. SSO users come back on their next sign-in if still allowed. */
export const DELETE: RequestHandler = handler(({ locals, params }) => {
	requireAdmin(locals);
	const u = load(params.id);
	if (u.id === locals.user?.id) throw new Conflict("You can't remove yourself");
	if (u.role === 'admin' && countAdmins() <= 1) throw new Conflict('Keep at least one admin');
	deleteUser(u.id);
	return json({ ok: true });
});
