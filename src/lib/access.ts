/**
 * Who may do what, in one place for the server (which enforces it) and the pages (which hide
 * what you can't do). Admins: everything. Members: start sessions, and control the ones they
 * started; other people's they can watch. Viewers: watch, change nothing. The organization's
 * settings (its accounts, GitHub connections, profiles, automations, the Library, sign-in) are
 * for admins; a member's own model sign-ins and GitHub connections are theirs alone.
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

/**
 * Whether sessions started by `userId` may use an account or connection: the organization's
 * (no owner), or their own. Nobody's sessions (automations) only get the organization's.
 */
export const usableBy = (userId: string | null | undefined, x: { ownerId: string | null }) => !x.ownerId || (!!userId && x.ownerId === userId);

/** What an id in an API path is, for whose it is. */
export type Owned = 'session' | 'model-account' | 'github-account';

/** Changes anyone signed in may make to their own things. */
const OWN = [/^\/api\/auth\//, /^\/api\/account$/];
/** Changes a member may make (besides their own sessions). */
const MEMBER = [
	/^\/api\/sessions$/,
	/^\/api\/notion\/connect$/,
	/^\/api\/github\/repos$/,
	// Their own model sign-ins and GitHub connections (the endpoints make them theirs).
	/^\/api\/model-accounts$/,
	/^\/api\/github-accounts$/,
	/^\/api\/github\/device(\/poll)?$/
];
const OWNED: [RegExp, Owned][] = [
	[/^\/api\/sessions\/([^/]+)(?:\/|$)/, 'session'],
	[/^\/api\/model-accounts\/([^/]+)(?:\/|$)/, 'model-account'],
	// …/apps adds GitHub Apps: not a connection's id.
	[/^\/api\/github-accounts\/(?!apps(?:\/|$))([^/]+)(?:\/|$)/, 'github-account']
];

/**
 * Why `who` may not make this API request, or null when they may. Reads are open to anyone
 * signed in, except someone else's own accounts; `ownerOf` says whose a session or account is
 * (null: nobody's, the organization's; undefined: there's no such thing).
 */
export function apiDenied(who: Who, method: string, path: string, ownerOf: (what: Owned, id: string) => string | null | undefined): string | null {
	const read = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
	const [what, id] = OWNED.map(([r, w]) => [w, r.exec(path)?.[1]] as const).find(([, id]) => id) ?? [];
	const owner = what && id ? ownerOf(what, id) : undefined;
	// Someone's own account or GitHub connection: theirs to use and change. Admins can see it's
	// there and remove it, but not use it (or read what it reaches).
	if (what && what !== 'session' && owner && owner !== who?.id) {
		return who?.role === 'admin' && method === 'DELETE' ? null : "That's someone else's own account: only they can use or change it.";
	}
	if (read) return null;
	if (!who) return 'Not signed in';
	if (who.role === 'admin' || OWN.some((r) => r.test(path))) return null;
	if (who.role === 'viewer') return 'You have view-only access to Orbital.';
	if (what && owner === undefined) return null; // no such thing: the endpoint says so
	if (what === 'session') return canControl(who, { ownerId: owner ?? null }) ? null : "This isn't your session: you can watch it, but only the person who started it (or an admin) can change it.";
	if (what) return owner === who.id ? null : "Only an admin can change the organization's accounts.";
	if (MEMBER.some((r) => r.test(path))) return null;
	return 'Only an admin can change this.';
}
