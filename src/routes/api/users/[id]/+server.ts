import { json } from '@sveltejs/kit';
import { BadRequest, body, Conflict, handler, NotFound, requireLastingAdmin } from '#lib/server/http.ts';
import { countAdmins, deleteAccessRequest, deleteUser, getUser, setTempRole, setUserRole, unpinUserRole } from '#lib/server/store.ts';
import type { UserRole } from '#lib/types.ts';
import type { RequestHandler } from './$types';

const ROLES: UserRole[] = ['admin', 'member', 'viewer'];

function load(id: string) {
	const u = getUser(id);
	if (!u) throw new NotFound('User not found');
	return u;
}

/**
 * Changes someone's access, one of:
 * - `role`: their lasting role, set by hand (sign-in rules no longer change it);
 * - `followRules: true`: back to what the sign-in rules give them;
 * - `tempRole` and `hours`: a higher role for a while (`tempRole: null` ends it now);
 * - `decline: true`: turns their access request down.
 * There is always at least one lasting admin.
 */
export const PATCH: RequestHandler = handler(async ({ locals, params, request }) => {
	requireLastingAdmin(locals);
	const u = load(params.id);
	const b = await body(request);
	const lastAdmin = u.baseRole === 'admin' && countAdmins() <= 1;
	if (b.decline === true) deleteAccessRequest(u.id);
	else if (b.followRules === true) {
		if (u.source === 'local') throw new BadRequest('Sign-in rules only apply to single sign-on users');
		if (lastAdmin && !/^admin\b/.test(u.roleRule ?? '')) throw new Conflict('Keep at least one admin');
		unpinUserRole(u.id);
	} else if ('tempRole' in b) {
		if (b.tempRole === null) setTempRole(u.id, null, null);
		else {
			const role = b.tempRole as UserRole;
			const hours = Number(b.hours);
			if (role !== 'admin' && role !== 'member') throw new BadRequest('A role for a while is member or admin');
			if (!(hours > 0 && hours <= 24 * 30)) throw new BadRequest('Give it between 1 hour and 30 days');
			if (role === u.baseRole || (role === 'member' && u.baseRole === 'admin')) throw new BadRequest(`They're already ${u.baseRole === 'admin' ? 'an admin' : 'a member'}`);
			setTempRole(u.id, role, new Date(Date.now() + hours * 3600_000).toISOString());
		}
	} else {
		const role = b.role as UserRole;
		if (!ROLES.includes(role)) throw new BadRequest('Role must be admin, member or viewer');
		if (lastAdmin && role !== 'admin') throw new Conflict('Keep at least one admin');
		// Local accounts aren't touched by sign-in rules, so there's nothing to pin against.
		setUserRole(u.id, role, u.source !== 'local');
	}
	return json(getUser(u.id));
});

/** Removes someone and signs them out. SSO users come back on their next sign-in if still allowed. */
export const DELETE: RequestHandler = handler(({ locals, params }) => {
	requireLastingAdmin(locals);
	const u = load(params.id);
	if (u.id === locals.user?.id) throw new Conflict("You can't remove yourself");
	if (u.baseRole === 'admin' && countAdmins() <= 1) throw new Conflict('Keep at least one admin');
	deleteUser(u.id);
	return json({ ok: true });
});
