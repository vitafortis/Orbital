import { json } from '@sveltejs/kit';
import { BadRequest, body, handler, str } from '#lib/server/http.ts';
import { allRepos, createRepo } from '#lib/server/github.ts';
import { githubAccountForSession, usableGithub } from '#lib/server/owned.ts';
import type { RequestHandler } from './$types';

/** Every token's repos in one list; ?owner=… one owner's; ?search=… GitHub's search by name. */
export const GET: RequestHandler = handler(async ({ url, locals }) =>
	json(
		await allRepos({
			owner: url.searchParams.get('owner') ?? undefined,
			search: url.searchParams.get('search') ?? undefined,
			refresh: url.searchParams.has('refresh')
		}, usableGithub(locals.user?.id))
	)
);

/** Creates a repository with one GitHub account's token, for a new session. */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	const b = await body(request);
	const account = githubAccountForSession(str(b, 'githubAccountId', { required: true })!, locals.user?.id ?? null);
	if (!account) throw new BadRequest('Unknown GitHub account');
	return json(
		await createRepo(account, {
			owner: str(b, 'owner', { required: true, max: 39 })!,
			name: str(b, 'name', { required: true, max: 100 })!,
			private: b.private !== false,
			description: str(b, 'description', { max: 350 })
		})
	);
});
