import { json } from '@sveltejs/kit';
import { body, handler, requireAdmin, str } from '#lib/server/http.ts';
import { startAwsLogin } from '#lib/server/aws.ts';
import type { RequestHandler } from './$types';

/** Starts signing in to an AWS access portal: returns the code to confirm in the browser. */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	requireAdmin(locals);
	const b = await body(request);
	return json(
		await startAwsLogin({
			startUrl: str(b, 'startUrl', { required: true, max: 300 })!,
			ssoRegion: str(b, 'ssoRegion', { required: true, max: 30 })!,
			label: str(b, 'label', { max: 80 })
		})
	);
});
