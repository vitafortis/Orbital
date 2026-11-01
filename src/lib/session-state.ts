import type { Session, SessionLive } from './types.ts';

export type DisplayState = 'working' | 'waiting' | 'idle' | 'shell' | 'starting' | 'stopped' | 'error';

/**
 * Each state's look, used everywhere a session shows: its dot, badge, and the glow around its
 * card, terminal and sidebar row. Blue while the agent works, green when it's idle, yellow
 * when it needs you, red on an error, gray when it's stopped. Keep them in one place so a
 * session never shows two colours at once.
 */
export const STATE_META: Record<DisplayState, { label: string; dot: string; badge: string; glow: string; pulse?: boolean }> = {
	working: { label: 'Working', dot: 'bg-primary', badge: 'badge-primary', glow: 'glow-blue glow-breathe', pulse: true },
	waiting: { label: 'Needs you', dot: 'bg-warning', badge: 'badge-warning', glow: 'glow-yellow glow-pulse', pulse: true },
	idle: { label: 'Idle', dot: 'bg-success', badge: 'badge-success', glow: 'glow-green' },
	shell: { label: 'Shell', dot: 'bg-muted-foreground', badge: '', glow: 'glow-gray' },
	starting: { label: 'Starting', dot: 'bg-primary/60', badge: 'badge-primary', glow: 'glow-blue glow-breathe', pulse: true },
	stopped: { label: 'Stopped', dot: 'bg-muted-foreground/40', badge: '', glow: 'glow-gray' },
	error: { label: 'Error', dot: 'bg-danger', badge: 'badge-danger', glow: 'glow-red' }
};

/**
 * The glow around a session (its card, and inset its terminal), in its state's colour; gray
 * when `connected` is false (its terminal lost the container).
 */
export function glowClass(state: DisplayState, opts: { inset?: boolean; small?: boolean; connected?: boolean } = {}): string {
	const base = opts.small ? 'glow-sm' : opts.inset ? 'glow-inset' : 'glow';
	return `${base} ${opts.connected === false ? 'glow-gray' : STATE_META[state].glow}`;
}

/** One state for dots and badges, from the stored status and what the terminal shows. */
export function displayState(s: Session, live: SessionLive | undefined): DisplayState {
	if (s.status === 'error') return 'error';
	if (s.status === 'starting') return 'starting';
	if (s.status === 'stopped') return 'stopped';
	switch (live?.state) {
		case 'working':
		case 'waiting':
		case 'idle':
		case 'shell':
		case 'starting':
			return live.state;
		default:
			return 'idle';
	}
}

/** When a session last did something: its newest conversation, else when it started. */
const lastActive = (s: Session, live: Record<string, SessionLive>) => live[s.id]?.summary?.updatedAt ?? s.lastStartedAt ?? s.createdAt;

/** Sessions that need a person first, then busy ones, then the rest by recency. */
export function sortForOverview(list: Session[], live: Record<string, SessionLive>): Session[] {
	const rank: Record<DisplayState, number> = { waiting: 0, error: 1, working: 2, starting: 3, idle: 4, shell: 5, stopped: 6 };
	return [...list].sort((a, b) => rank[displayState(a, live[a.id])] - rank[displayState(b, live[b.id])] || lastActive(b, live).localeCompare(lastActive(a, live)));
}

/**
 * Newest activity first, whatever the state, so the sidebar doesn't shuffle each time a
 * session starts or finishes a turn.
 */
export function sortByRecency(list: Session[], live: Record<string, SessionLive>): Session[] {
	return [...list].sort((a, b) => lastActive(b, live).localeCompare(lastActive(a, live)));
}
