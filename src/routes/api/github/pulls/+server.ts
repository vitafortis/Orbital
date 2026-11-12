import { json } from '@sveltejs/kit';
import { BadRequest, handler } from '#lib/server/http.ts';
import { listPulls, searchPulls } from '#lib/server/github.ts';
import { getGithubAccount } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Open pull requests of owner/name, for "check out a pull request"; ?search=… one by number, or open ones matching words. */
export const GET: RequestHandler = handler(async ({ url }) => {
	const repo = url.searchParams.get('repo');
	if (!repo) throw new BadRequest('"repo" is required');
	const accountId = url.searchParams.get('account');
	const account = accountId ? (getGithubAccount(accountId) ?? null) : null;
	const search = url.searchParams.get('search');
	return json(search ? await searchPulls(account, repo, search) : await listPulls(account, repo));
});
