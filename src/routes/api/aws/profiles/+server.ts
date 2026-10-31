import { json } from '@sveltejs/kit';
import { body, handler, requireAdmin } from '#lib/server/http.ts';
import { parseAwsProfileInput } from '#lib/server/aws-input.ts';
import { createAwsProfile } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = handler(async ({ request, locals }) => {
	requireAdmin(locals);
	return json(createAwsProfile(await parseAwsProfileInput(await body(request))), { status: 201 });
});
