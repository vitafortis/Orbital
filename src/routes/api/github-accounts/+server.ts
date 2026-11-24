import { json } from '@sveltejs/kit';
import { body, handler, str } from '#lib/server/http.ts';
import { addGithubToken, deviceFlowEnabled } from '#lib/server/github.ts';
import { githubAccountsFor } from '#lib/server/owned.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => json({ accounts: githubAccountsFor(locals.user), deviceFlow: deviceFlowEnabled() });

/**
 * Adds a personal access token, with an optional name (the same token again updates the saved
 * one): the organization's when an admin adds it, unless they say `personal`; a member's own.
 */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	const b = await body(request);
	const label = str(b, 'label', { max: 80 }) ?? null;
	const ownerId = locals.user?.role !== 'admin' || b.personal === true ? (locals.user?.id ?? null) : null;
	return json(await addGithubToken(str(b, 'token', { required: true, max: 400 })!, 'pat', { label, ownerId }), { status: 201 });
});
