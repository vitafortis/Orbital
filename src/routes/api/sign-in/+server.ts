import { json } from '@sveltejs/kit';
import { getAuthSettings, saveAuthSettings } from '#lib/server/auth-config.ts';
import { parseAuthSettings } from '#lib/server/auth-input.ts';
import { body, handler, requireLastingAdmin } from '#lib/server/http.ts';
import { callbackUrl, discover } from '#lib/server/oidc.ts';
import { getSettings } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

const view = (origin: string) => ({ settings: getAuthSettings(), callbackUrl: callbackUrl(getSettings().publicUrl || origin) });

export const GET: RequestHandler = handler(({ locals }) => {
	requireLastingAdmin(locals);
	return json(view(locals.origin));
});

/** Saves sign-in settings. clientSecret: a new one, null to remove it, absent to keep it. */
export const PUT: RequestHandler = handler(async ({ locals, request }) => {
	requireLastingAdmin(locals);
	const b = await body(request);
	const s = parseAuthSettings(b);
	// A wrong issuer would only show up at the next sign-in; catch it now.
	if (s.oidc.enabled) await discover(s.oidc.issuer, true);
	const secret = b.clientSecret === null ? null : typeof b.clientSecret === 'string' && b.clientSecret.trim() ? b.clientSecret.trim() : undefined;
	saveAuthSettings(s, secret);
	return json(view(locals.origin));
});
