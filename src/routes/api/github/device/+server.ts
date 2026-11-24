import { json } from '@sveltejs/kit';
import { handler } from '#lib/server/http.ts';
import { startDeviceFlow } from '#lib/server/github.ts';
import type { RequestHandler } from './$types';

/**
 * Starts "Sign in with GitHub": returns the code to enter at github.com/login/device. The
 * connection is the person's own; an admin can make it the organization's (`organization`).
 */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	const b = await request.json().catch(() => ({}));
	const me = locals.user?.id ?? null;
	return json(await startDeviceFlow(me, locals.user?.role === 'admin' && b?.organization === true ? null : me));
});
