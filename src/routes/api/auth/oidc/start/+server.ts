import { BadRequest } from '#lib/server/http.ts';
import { STATE_COOKIE, startSignIn } from '#lib/server/oidc.ts';
import { getSettings } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/**
 * Sends the browser to the provider. Settings → Public URL, when set, decides the callback
 * address. `?link=1`: a signed-in user links their SSO identity, and comes back to their profile.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const n = url.searchParams.get('next') ?? '/';
	const next = n.startsWith('/') && !n.startsWith('//') ? n : '/';
	let target: string;
	try {
		const link = url.searchParams.has('link') && locals.user && locals.user.id !== 'open' ? locals.user.id : null;
		const { url: to, state } = await startSignIn(getSettings().publicUrl || locals.origin, link ? '/settings?sso=linked#account' : next, link);
		// Lax: the provider's redirect back is a top-level GET, which carries it.
		cookies.set(STATE_COOKIE, state, { path: '/api/auth/oidc', httpOnly: true, sameSite: 'lax', secure: locals.secure, maxAge: 600 });
		target = to;
	} catch (err) {
		const msg = err instanceof BadRequest ? err.message : 'Single sign-on failed to start';
		if (!(err instanceof BadRequest)) console.error('[orbital] SSO:', err);
		target = `/login?error=${encodeURIComponent(msg)}`;
	}
	// A plain response: redirect() refuses other sites, and the provider is one.
	return new Response(null, { status: 303, headers: { location: target } });
};
