import { redirect } from '@sveltejs/kit';
import { getAuthSettings } from '#lib/server/auth-config.ts';
import { config } from '#lib/server/config.ts';
import { callbackUrl } from '#lib/server/oidc.ts';
import { getSettings, listAccessRequests, listUsers } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user?.role !== 'admin') redirect(303, '/settings');
	return {
		auth: getAuthSettings(),
		callbackUrl: callbackUrl(getSettings().publicUrl || locals.origin),
		publicUrlSet: !!getSettings().publicUrl,
		users: listUsers(),
		requests: listAccessRequests(),
		me: locals.user.id,
		// What to put in "trusted proxies": where this very request came from.
		clientAddress: locals.ip ?? null,
		envDisabled: config.authDisabled
	};
};
