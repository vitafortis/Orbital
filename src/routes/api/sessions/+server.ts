import { json } from '@sveltejs/kit';
import { body, Forbidden, handler } from '#lib/server/http.ts';
import { launchNewSession } from '#lib/server/sessions/create.ts';
import { parseSessionInput } from '#lib/server/sessions/input.ts';
import { sessionsFor } from '#lib/server/visibility.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => json(sessionsFor(locals.user));

/** Creates a session and starts it in the background (the first start may pull the image). */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	const b = await body(request);
	// Shared (the organization's): admins start those.
	if (b.shared === true && locals.user?.role !== 'admin') throw new Forbidden('Only an admin can start a shared session');
	return json(await launchNewSession(parseSessionInput(b), { ownerId: locals.user?.id ?? null, shared: b.shared === true }), { status: 201 });
});
