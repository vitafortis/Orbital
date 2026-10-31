import { json } from '@sveltejs/kit';
import { handler, NotFound, requireAdmin } from '#lib/server/http.ts';
import { profileCredentials } from '#lib/server/aws.ts';
import { getAwsProfile } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Gets the profile's credentials as a session would; says until when they're good (never the keys). */
export const POST: RequestHandler = handler(async ({ params, locals }) => {
	requireAdmin(locals);
	const p = getAwsProfile(params.id);
	if (!p) throw new NotFound('AWS profile not found');
	const c = await profileCredentials(p);
	return json({ expiresAt: new Date(c.expiresAt).toISOString() });
});
