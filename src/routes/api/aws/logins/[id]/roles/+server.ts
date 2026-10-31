import { json } from '@sveltejs/kit';
import { BadRequest, handler, requireAdmin } from '#lib/server/http.ts';
import { listAwsRoles } from '#lib/server/aws.ts';
import type { RequestHandler } from './$types';

/** ?account=<id>: the roles (permission sets) this sign-in has there. */
export const GET: RequestHandler = handler(async ({ params, url, locals }) => {
	requireAdmin(locals);
	const account = url.searchParams.get('account');
	if (!account) throw new BadRequest('Name the account');
	return json(await listAwsRoles(params.id, account));
});
