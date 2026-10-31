import { json } from '@sveltejs/kit';
import { body, handler, NotFound, requireAdmin, str } from '#lib/server/http.ts';
import { forgetCredentials } from '#lib/server/aws.ts';
import { refreshAwsCredentials } from '#lib/server/sessions/aws.ts';
import { deleteAwsLogin, getAwsLogin, listAwsProfiles, setAwsLoginLabel } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = handler(async ({ params, request, locals }) => {
	requireAdmin(locals);
	if (!getAwsLogin(params.id)) throw new NotFound('AWS sign-in not found');
	setAwsLoginLabel(params.id, str(await body(request), 'label', { max: 80 }));
	return json(getAwsLogin(params.id));
});

/** Forgets the sign-in and its profiles; running sessions lose those credentials at once. */
export const DELETE: RequestHandler = handler(async ({ params, locals }) => {
	requireAdmin(locals);
	const ids = new Set(listAwsProfiles().filter((p) => p.loginId === params.id).map((p) => p.id));
	if (!deleteAwsLogin(params.id)) throw new NotFound('AWS sign-in not found');
	forgetCredentials({ loginId: params.id });
	await refreshAwsCredentials((s) => s.awsProfileIds.some((id) => ids.has(id)));
	return json({ ok: true });
});
