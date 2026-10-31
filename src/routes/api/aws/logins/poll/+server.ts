import { json } from '@sveltejs/kit';
import { body, handler, requireAdmin, str } from '#lib/server/http.ts';
import { pollAwsLogin } from '#lib/server/aws.ts';
import { refreshAwsCredentials } from '#lib/server/sessions/aws.ts';
import { listAwsProfiles } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = handler(async ({ request, locals }) => {
	requireAdmin(locals);
	const r = await pollAwsLogin(str(await body(request), 'handle', { required: true })!);
	// Signed in again: sessions waiting on this sign-in get their credentials now.
	if (r.login) {
		const ids = new Set(listAwsProfiles().filter((p) => p.loginId === r.login!.id).map((p) => p.id));
		await refreshAwsCredentials((s) => s.awsProfileIds.some((id) => ids.has(id)));
	}
	return json(r);
});
