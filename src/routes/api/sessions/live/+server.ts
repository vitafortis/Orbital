import { sseResponse } from '#lib/server/sse.ts';
import { subscribeLive } from '#lib/server/sessions/live.ts';
import { listSessions } from '#lib/server/store.ts';
import { liveFor, ownerNames, sessionsFor } from '#lib/server/visibility.ts';
import type { RequestHandler } from './$types';

/** Server-Sent Events: the sessions and their live state after every poll. */
export const GET: RequestHandler = ({ request, locals }) =>
	sseResponse(request.signal, (channel) =>
		subscribeLive((live) => {
			// Each person gets the sessions they may see, as they may see them.
			const all = listSessions();
			const sessions = sessionsFor(locals.user, all);
			channel.send('live', { sessions, live: liveFor(locals.user, live, all), owners: ownerNames(sessions) });
		})
	);
