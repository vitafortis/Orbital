import type { LayoutServerLoad } from './$types';
import { rememberOrigin } from '#lib/server/linear.ts';
import { liveSnapshot } from '#lib/server/sessions/live.ts';
import { listSessions } from '#lib/server/store.ts';
import type { Viewer } from '#lib/types.ts';

export const load: LayoutServerLoad = ({ locals }) => {
	const user = locals.user;
	const signedIn = locals.auth === 'authenticated' || locals.auth === 'disabled';
	// Links in Linear comments point back here unless Settings names a public URL.
	if (signedIn) rememberOrigin(locals.origin);
	const viewer: Viewer | null = user ? { email: user.email, name: user.name, admin: user.role === 'admin' } : null;
	return {
		auth: locals.auth,
		version: __APP_VERSION__,
		viewer,
		sessions: signedIn ? listSessions() : [],
		live: signedIn ? liveSnapshot() : []
	};
};
