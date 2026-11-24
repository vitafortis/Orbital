import type { PageServerLoad } from './$types';
import { getAuthSettings } from '#lib/server/auth-config.ts';
import { getSettings } from '#lib/server/store.ts';

export const load: PageServerLoad = ({ locals }) => ({
	settings: getSettings(),
	account:
		locals.user && locals.user.id !== 'open'
			? { email: locals.user.email, name: locals.user.name, source: locals.user.source, hasPassword: locals.user.hasPassword, ssoLinked: locals.user.ssoLinked }
			: null,
	// Whether there's single sign-on to link, and whether passwords are for admins only.
	sso: { oidc: getAuthSettings().oidc.enabled, ssoOnly: !getAuthSettings().passwordForm && (getAuthSettings().oidc.enabled || getAuthSettings().proxy.enabled) },
	admin: locals.user?.role === 'admin'
});
