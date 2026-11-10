import { json } from '@sveltejs/kit';
import { BadRequest, handler, NotFound } from '#lib/server/http.ts';
import { renewGithubToken } from '#lib/server/github.ts';
import { getGithubAccount } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Renews the connection's token now (after fixing what stopped it, say). */
export const POST: RequestHandler = handler(async ({ params }) => {
	const a = getGithubAccount(params.id);
	if (!a) throw new NotFound('Account not found');
	if (!a.renews) throw new BadRequest("This token doesn't renew");
	await renewGithubToken(a.id).catch((err) => {
		throw new BadRequest(err instanceof Error ? err.message : String(err));
	});
	return json(getGithubAccount(a.id));
});
