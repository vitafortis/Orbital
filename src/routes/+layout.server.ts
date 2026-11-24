import type { LayoutServerLoad } from './$types';
import { rememberOrigin } from '#lib/server/linear.ts';
import { liveSnapshot } from '#lib/server/sessions/live.ts';
import { listAccessRequests, listSessions } from '#lib/server/store.ts';
import type { Viewer } from '#lib/types.ts';

export const load: LayoutServerLoad = ({ locals }) => {
	const user = locals.user;
	const signedIn = locals.auth === 'authenticated' || locals.auth === 'disabled';
	// Links in Linear comments point back here unless Settings names a public URL.
	if (signedIn) rememberOrigin(locals.origin);
	const asked = user && user.role !== 'admin' ? (listAccessRequests().find((r) => r.userId === user.id)?.role ?? null) : null;
	const viewer: Viewer | null = user ? { id: user.id, email: user.email, name: user.name, role: user.role, admin: user.role === 'admin', tempUntil: user.tempUntil, asked } : null;
	return {
		auth: locals.auth,
		version: __APP_VERSION__,
		viewer,
		sessions: signedIn ? listSessions() : [],
		live: signedIn ? liveSnapshot() : []
	};
};
