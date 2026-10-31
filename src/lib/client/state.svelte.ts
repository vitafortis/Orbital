import { getContext, setContext } from 'svelte';
import type { Session, SessionLive, Viewer } from '#lib/types.ts';

type Toast = { id: number; kind: 'info' | 'success' | 'error'; title: string; body?: string };

let nextToast = 1;
export const toasts = $state<Toast[]>([]);

export function toast(kind: Toast['kind'], title: string, body?: string) {
	const id = nextToast++;
	toasts.push({ id, kind, title, body });
	setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3500);
}

export function dismiss(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i !== -1) toasts.splice(i, 1);
}

export const theme = $state<{ value: 'dark' | 'light' }>({ value: 'dark' });

export function setTheme(value: 'dark' | 'light') {
	theme.value = value;
	document.documentElement.dataset.theme = value;
	try {
		localStorage.setItem('orb-theme', value);
	} catch {}
}

/** The signed-in user; set by the root layout. */
export const session = $state<{ viewer: Viewer | null }>({ viewer: null });

type ConfirmRequest = {
	title: string;
	body?: string;
	/** Monospace detail, e.g. what's about to be deleted. */
	detail?: string;
	confirmLabel?: string;
	danger?: boolean;
	resolve: (ok: boolean) => void;
};

/** The open confirmation dialog, rendered once by the root layout. */
export const confirmation = $state<{ request: ConfirmRequest | null }>({ request: null });

/** Asks the user to confirm; resolves false if they cancel or dismiss. */
export function confirmAction(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
	confirmation.request?.resolve(false);
	return new Promise((resolve) => (confirmation.request = { ...opts, resolve }));
}

/**
 * Sessions and their live state, shared by the sidebar, overview and session pages.
 * Seeded by the layout's load, then kept current by one Server-Sent Events stream.
 */
export const sessions = $state<{ list: Session[]; live: Record<string, SessionLive>; connected: boolean; seeded: boolean }>({
	list: [],
	live: {},
	// Set once the layout has filled the store in the browser (never in the server render).
	seeded: false,
	// Optimistic: "offline" shows only after the stream actually drops.
	connected: true
});

type SessionsView = { readonly list: Session[]; readonly live: Record<string, SessionLive> };
const VIEW = Symbol('sessions');

/**
 * For the root layout: what the pages read sessions from. The shared store once it's seeded in
 * the browser; before that (the server render, the first frame) the layout's own load data, so
 * the page arrives with its sessions instead of filling them in after it has been drawn.
 */
export function provideSessions(load: () => { sessions: Session[]; live: SessionLive[] }): SessionsView {
	const view: SessionsView = {
		get list() {
			return sessions.seeded ? sessions.list : load().sessions;
		},
		get live() {
			return sessions.seeded ? sessions.live : Object.fromEntries(load().live.map((l) => [l.id, l]));
		}
	};
	setContext(VIEW, view);
	return view;
}

/** The sessions and their live state, from provideSessions. */
export const useSessions = () => getContext<SessionsView>(VIEW);

let source: EventSource | null = null;

export function connectLive(): () => void {
	source?.close();
	const es = new EventSource('/api/sessions/live');
	source = es;
	es.onopen = () => (sessions.connected = true);
	es.onerror = () => (sessions.connected = false);
	es.addEventListener('live', (e) => {
		const d = JSON.parse((e as MessageEvent).data) as { sessions: Session[]; live: SessionLive[] };
		sessions.list = d.sessions;
		sessions.live = Object.fromEntries(d.live.map((l) => [l.id, l]));
		sessions.connected = true;
	});
	return () => {
		es.close();
		if (source === es) source = null;
	};
}

/** Applies a session the API just returned, before the next live update arrives. */
export function upsertSession(s: Session) {
	const i = sessions.list.findIndex((x) => x.id === s.id);
	if (i === -1) sessions.list.unshift(s);
	else sessions.list[i] = s;
}

/** Sessions deleted from this tab, which says so itself; a session page tells only of the others. */
export const deletedHere = new Set<string>();

export function removeSessionLocal(id: string) {
	deletedHere.add(id);
	sessions.list = sessions.list.filter((s) => s.id !== id);
	delete sessions.live[id];
}
