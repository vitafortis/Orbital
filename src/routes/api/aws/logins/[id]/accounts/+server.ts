import { json } from '@sveltejs/kit';
import { handler, requireAdmin } from '#lib/server/http.ts';
import { listAwsAccounts } from '#lib/server/aws.ts';
import type { RequestHandler } from './$types';

/** The accounts this sign-in can reach, for picking a profile's account. */
export const GET: RequestHandler = handler(async ({ params, locals }) => {
	requireAdmin(locals);
	return json(await listAwsAccounts(params.id));
});
