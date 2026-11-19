/**
 * Who may do what, in one place for the server (which enforces it) and the pages (which hide
 * what you can't do). Admins: everything. Members: start sessions, and control the ones they
 * started; other people's they can watch. Viewers: watch, change nothing. Shared settings
 * (accounts, GitHub connections, profiles, automations, the Library, sign-in) are for admins.
 */
import type { Session, UserRole } from './types.ts';

export type Who = { id: string; role: UserRole } | null | undefined;

export const ROLE_LABEL: Record<UserRole, string> = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };

/** Whether `who` may type into, start, stop, restart or delete the session. */
export function canControl(who: Who, s: Pick<Session, 'ownerId'>): boolean {
	if (!who) return false;
	if (who.role === 'admin') return true;
	return who.role === 'member' && !!s.ownerId && s.ownerId === who.id;
}

export const canStartSessions = (who: Who) => who?.role === 'admin' || who?.role === 'member';

/** Changes anyone signed in may make to their own things. */
const OWN = [/^\/api\/auth\//, /^\/api\/account$/];
/** Changes a member may make (besides their own sessions). */
const MEMBER = [/^\/api\/sessions$/, /^\/api\/notion\/connect$/, /^\/api\/github\/repos$/];

/**
 * Why `who` may not make this API request, or null when they may. Reads are open to anyone
 * signed in; `ownerOf` says whose a session is.
 */
export function apiDenied(who: Who, method: string, path: string, ownerOf: (sessionId: string) => string | null | undefined): string | null {
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
	if (!who) return 'Not signed in';
	if (who.role === 'admin' || OWN.some((r) => r.test(path))) return null;
	if (who.role === 'viewer') return 'You have view-only access to Orbital.';
	const session = /^\/api\/sessions\/([^/]+)(?:\/|$)/.exec(path)?.[1];
	if (session) {
		const owner = ownerOf(session);
		if (owner === undefined) return null; // no such session: the endpoint says so
		return canControl(who, { ownerId: owner }) ? null : "This isn't your session: you can watch it, but only the person who started it (or an admin) can change it.";
	}
	if (MEMBER.some((r) => r.test(path))) return null;
	return 'Only an admin can change this.';
}
