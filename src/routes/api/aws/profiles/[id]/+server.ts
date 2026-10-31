import { json } from '@sveltejs/kit';
import { body, handler, NotFound, requireAdmin } from '#lib/server/http.ts';
import { parseAwsProfileInput } from '#lib/server/aws-input.ts';
import { forgetCredentials } from '#lib/server/aws.ts';
import { refreshAwsCredentials } from '#lib/server/sessions/aws.ts';
import { deleteAwsProfile, getAwsProfile, updateAwsProfile } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Running sessions with the profile get credentials for its new account or role at once. */
export const PATCH: RequestHandler = handler(async ({ params, request, locals }) => {
	requireAdmin(locals);
	if (!getAwsProfile(params.id)) throw new NotFound('AWS profile not found');
	updateAwsProfile(params.id, await parseAwsProfileInput(await body(request), params.id));
	forgetCredentials({ profileId: params.id });
	await refreshAwsCredentials((s) => s.awsProfileIds.includes(params.id));
	return json(getAwsProfile(params.id));
});

/** Running sessions with the profile lose its credentials at once. */
export const DELETE: RequestHandler = handler(async ({ params, locals }) => {
	requireAdmin(locals);
	if (!deleteAwsProfile(params.id)) throw new NotFound('AWS profile not found');
	forgetCredentials({ profileId: params.id });
	await refreshAwsCredentials((s) => s.awsProfileIds.includes(params.id));
	return json({ ok: true });
});
