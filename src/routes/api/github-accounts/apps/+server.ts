import { json } from '@sveltejs/kit';
import { body, handler, requireAdmin, str } from '#lib/server/http.ts';
import { addGithubApp } from '#lib/server/github.ts';
import type { RequestHandler } from './$types';

/** Connects a GitHub App by its ID and private key: one connection per installation. Admins only: it acts for the whole installation. */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	requireAdmin(locals);
	const b = await body(request);
	const accounts = await addGithubApp(str(b, 'appId', { required: true, max: 12 })!, str(b, 'privateKey', { required: true, max: 10_000 })!, str(b, 'label', { max: 80 }) ?? null);
	return json({ accounts }, { status: 201 });
});
