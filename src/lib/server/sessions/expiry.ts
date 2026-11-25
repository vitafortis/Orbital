/**
 * Session expiry, to keep sessions short-lived (Settings → General): a session idle for
 * `idleStopHours` is stopped, and one stopped for `deleteStoppedDays` is deleted, clone and
 * conversations with it. Sessions people start and those automations start have their own
 * defaults; a Linear rule can set its sessions' own, and any session its own (expiryFor). Idle: nothing new in its conversation and nothing typed in its
 * terminals (the Shell tab too) for that long, and its agent not working. Checked from the
 * live poll.
 */
import type { Session, SessionLive, Settings } from '#lib/types.ts';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// Keystrokes in a session's terminals and messages sent to it, since Orbital started.
const lastInput = new Map<string, number>();

/** Someone typed in (or sent to) the session: it isn't idle. */
export function touchSession(id: string, now = Date.now()) {
	lastInput.set(id, now);
}

type Expiry = Pick<Settings, 'idleStopHours' | 'deleteStoppedDays'>;

/** The expiry a session goes by: its own where it set one, else its kind's default. */
export function expiryFor(s: Pick<Session, 'idleStopHours' | 'deleteStoppedDays' | 'linear'>, settings: Pick<Settings, 'idleStopHours' | 'deleteStoppedDays' | 'autoIdleStopHours' | 'autoDeleteStoppedDays'>): Expiry {
	const auto = !!s.linear;
	return {
		idleStopHours: s.idleStopHours ?? (auto ? settings.autoIdleStopHours : settings.idleStopHours),
		deleteStoppedDays: s.deleteStoppedDays ?? (auto ? settings.autoDeleteStoppedDays : settings.deleteStoppedDays)
	};
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/** When expiry stops or deletes the session, if it will. */
export function expiryTimes(
	s: Pick<Session, 'id' | 'status' | 'lastStartedAt' | 'stoppedAt' | 'createdAt'>,
	live: Pick<SessionLive, 'state' | 'summary'>,
	settings: Expiry
): { stopsAt: string | null; deletesAt: string | null } {
	let stopsAt: string | null = null;
	let deletesAt: string | null = null;
	if (s.status === 'running' && settings.idleStopHours > 0 && live.state !== 'working') {
		const active = Math.max(time(live.summary?.updatedAt), time(s.lastStartedAt), lastInput.get(s.id) ?? 0);
		stopsAt = new Date(active + settings.idleStopHours * HOUR).toISOString();
	}
	if ((s.status === 'stopped' || s.status === 'error') && settings.deleteStoppedDays > 0) {
		const since = time(s.stoppedAt) || time(s.lastStartedAt) || time(s.createdAt);
		deletesAt = new Date(since + settings.deleteStoppedDays * DAY).toISOString();
	}
	return { stopsAt, deletesAt };
}

const failed = new Map<string, number>();
const RETRY = 5 * 60_000;

/** Stops and deletes what's due; a failure is logged and tried again five minutes later. */
export async function enforceExpiry(
	due: { id: string; name: string; stopsAt: string | null; deletesAt: string | null }[],
	act: { stop: (id: string) => Promise<unknown>; remove: (id: string) => Promise<unknown> },
	now = Date.now()
): Promise<{ stopped: string[]; deleted: string[] }> {
	const stopped: string[] = [];
	const deleted: string[] = [];
	for (const s of due) {
		if (now - (failed.get(s.id) ?? 0) < RETRY) continue;
		try {
			if (s.stopsAt && Date.parse(s.stopsAt) <= now) {
				await act.stop(s.id);
				lastInput.delete(s.id);
				stopped.push(s.id);
				console.log(`[orbital] expiry: stopped ${s.name}, idle for the set time`);
			} else if (s.deletesAt && Date.parse(s.deletesAt) <= now) {
				await act.remove(s.id);
				deleted.push(s.id);
				console.log(`[orbital] expiry: deleted ${s.name}, stopped long enough`);
			}
			failed.delete(s.id);
		} catch (err) {
			failed.set(s.id, now);
			console.error(`[orbital] expiry: couldn't expire ${s.name} (trying again in 5 minutes):`, err instanceof Error ? err.message : err);
		}
	}
	return { stopped, deleted };
}
