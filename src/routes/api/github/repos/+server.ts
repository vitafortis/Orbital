import { json } from '@sveltejs/kit';
import { BadRequest, body, handler, str } from '#lib/server/http.ts';
import { allRepos, createRepo } from '#lib/server/github.ts';
import { getGithubAccount } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Every token's repos in one list; ?owner=… one owner's; ?search=… GitHub's search by name. */
export const GET: RequestHandler = handler(async ({ url }) =>
	json(
		await allRepos({
			owner: url.searchParams.get('owner') ?? undefined,
			search: url.searchParams.get('search') ?? undefined,
			refresh: url.searchParams.has('refresh')
		})
	)
);

/** Creates a repository with one GitHub account's token, for a new session. */
export const POST: RequestHandler = handler(async ({ request }) => {
	const b = await body(request);
	const account = getGithubAccount(str(b, 'githubAccountId', { required: true })!);
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
