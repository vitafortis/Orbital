/**
 * Who may do what, in one place for the server (which enforces it) and the pages (which hide
 * what you can't do). Admins: everything. Members: start sessions, and control the ones they
 * started and shared ones (the organization's), but not a shared one's accounts. Other people's
 * they see as Sign-in & users says: watch them, their names only, or nothing; unless the owner
 * lets everyone watch. Viewers: see the same, change nothing. The organization's
 * settings (its accounts, GitHub connections, profiles, automations, the Library, sign-in) are
 * for admins; a member's own model sign-ins and GitHub connections are theirs alone.
 */
import type { OthersSessions, Session, UserRole } from './types.ts';

export type Who = { id: string; role: UserRole } | null | undefined;

export const ROLE_LABEL: Record<UserRole, string> = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };

type SessionAccess = Pick<Session, 'ownerId' | 'shared'> & Partial<Pick<Session, 'watchable'>>;

const isOwner = (who: Who, s: SessionAccess) => !!who && !!s.ownerId && s.ownerId === who.id;

/** Whether `who` may type into, start, stop, restart or delete the session. */
export function canControl(who: Who, s: SessionAccess): boolean {
	if (!who) return false;
	if (who.role === 'admin') return true;
	return who.role === 'member' && (s.shared || isOwner(who, s));
}

/** Whether `who` may change which accounts, GitHub connection and AWS profiles it uses, and who it's shared with. */
export function canChangeSetup(who: Who, s: SessionAccess): boolean {
	if (!who) return false;
	if (who.role === 'admin') return true;
	return who.role === 'member' && !s.shared && isOwner(who, s);
}

/** Whether `who` may watch it: its terminal (read-only), conversations, files and To do. */
export function canWatch(who: Who, s: SessionAccess, others: OthersSessions = 'names'): boolean {
	if (!who) return false;
	return who.role === 'admin' || s.shared || isOwner(who, s) || !!s.watchable || others === 'watch';
}

/** Whether `who` sees it in lists at all (its name, repo and state). */
export const canSeeSession = (who: Who, s: SessionAccess, others: OthersSessions = 'names') => canWatch(who, s, others) || (!!who && others === 'names');

export const canStartSessions = (who: Who) => who?.role === 'admin' || who?.role === 'member';

/**
 * Whether sessions started by `userId` may use an account or connection: the organization's
 * (no owner), or their own. Nobody's sessions (automations) only get the organization's.
 */
export const usableBy = (userId: string | null | undefined, x: { ownerId: string | null }) => !x.ownerId || (!!userId && x.ownerId === userId);

/** What an id in an API path is, for whose it is. */
export type Owned = 'session' | 'model-account' | 'github-account';

/** Changes anyone signed in may make to their own things. */
const OWN = [/^\/api\/auth\//, /^\/api\/account$/, /^\/api\/access-request$/];
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

/** What `ownerOf` knows about a session or account: whose it is, and a session's sharing. */
export type OwnerInfo = { ownerId: string | null; shared?: boolean; watchable?: boolean };

/**
 * Why `who` may not make this API request, or null when they may. Reads are open to anyone
 * signed in, except someone else's own accounts and sessions they may not watch; `ownerOf`
 * says whose a session or account is (ownerId null: nobody's, the organization's; undefined:
 * there's no such thing). `others`: what Sign-in & users lets people see of others' sessions.
 */
export function apiDenied(who: Who, method: string, path: string, ownerOf: (what: Owned, id: string) => OwnerInfo | undefined, others: OthersSessions = 'names'): string | null {
	const read = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
	const [what, id] = OWNED.map(([r, w]) => [w, r.exec(path)?.[1]] as const).find(([, id]) => id) ?? [];
	const info = what && id ? ownerOf(what, id) : undefined;
	const owner = info?.ownerId;
	const session = what === 'session' && info ? { ownerId: info.ownerId, shared: !!info.shared, watchable: !!info.watchable } : null;
	if (session && !canWatch(who, session, others)) return "That's someone else's session: they haven't shared it with you.";
	// Someone's own account or GitHub connection: theirs to use and change. Admins can see it's
	// there and remove it, but not use it (or read what it reaches).
	if (what && what !== 'session' && owner && owner !== who?.id) {
		return who?.role === 'admin' && method === 'DELETE' ? null : "That's someone else's own account: only they can use or change it.";
	}
	if (read) return null;
	if (!who) return 'Not signed in';
	if (who.role === 'admin' || OWN.some((r) => r.test(path))) return null;
	if (who.role === 'viewer') return 'You have view-only access to Orbital.';
	if (what && !info) return null; // no such thing: the endpoint says so
	if (session) return canControl(who, session) ? null : "This isn't your session: you can watch it, but only the person who started it (or an admin) can change it.";
	if (what) return owner === who.id ? null : "Only an admin can change the organization's accounts.";
	if (MEMBER.some((r) => r.test(path))) return null;
	return 'Only an admin can change this.';
}
