import { redirect } from '@sveltejs/kit';
import { startSession } from '#lib/server/auth.ts';
import { BadRequest } from '#lib/server/http.ts';
import { finishSignIn, STATE_COOKIE } from '#lib/server/oidc.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const state = cookies.get(STATE_COOKIE);
	cookies.delete(STATE_COOKIE, { path: '/api/auth/oidc' });
	let target: string;
	try {
		const { user, next, linked } = await finishSignIn(url.searchParams, state, locals.user?.id ?? null);
		// Linking keeps the sign-in they already have.
		if (!linked) startSession(cookies, user.id, locals.secure);
		target = next;
	} catch (err) {
		const msg = err instanceof BadRequest ? err.message : 'Single sign-on failed';
		if (!(err instanceof BadRequest)) console.error('[orbital] SSO:', err);
		target = `/login?error=${encodeURIComponent(msg)}`;
	}
	redirect(303, target);
};
