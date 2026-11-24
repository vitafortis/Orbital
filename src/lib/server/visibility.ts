/**
 * Sessions as each person may see them (see canWatch and canSeeSession in access.ts): ones they
 * may watch in full; someone else's as its name, repo and state only, when Sign-in & users says
 * "names"; none at all when it says "hidden". The pages get these, and so does the live stream.
 */
import { canSeeSession, canWatch, type Who } from '#lib/access.ts';
import type { Session, SessionLive } from '#lib/types.ts';
import { othersSessions } from './auth-config.ts';
import { getUser, listSessions } from './store.ts';

/** Someone else's session, by name: what it is and how it's doing, not what's in it. */
const nameOnly = (s: Session): Session => ({ ...s, skill: null, rcUrl: null, error: null, linear: null });
const liveNameOnly = (l: SessionLive): SessionLive => ({ ...l, tail: [], links: [], rcUrl: null, summary: null, git: null, aiSummary: null, aws: [], todos: [] });

export function sessionsFor(who: Who, all = listSessions()): Session[] {
	const others = othersSessions();
	return all.filter((s) => canSeeSession(who, s, others)).map((s) => (canWatch(who, s, others) ? s : nameOnly(s)));
}

export function liveFor(who: Who, live: SessionLive[], all = listSessions()): SessionLive[] {
	const others = othersSessions();
	const byId = new Map(all.map((s) => [s.id, s]));
	return live.flatMap((l) => {
		const s = byId.get(l.id);
		if (!s || !canSeeSession(who, s, others)) return [];
		return [canWatch(who, s, others) ? l : liveNameOnly(l)];
	});
}

/** The names of the people who started these sessions, for "Sam's session" and initials. */
export function ownerNames(sessions: Session[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const s of sessions) {
		if (!s.ownerId || s.ownerId in out) continue;
		const u = s.ownerId === 'open' ? null : getUser(s.ownerId);
		if (u) out[s.ownerId] = u.name ?? u.email;
	}
	return out;
}
