import { json } from '@sveltejs/kit';
import { BadRequest, handler } from '#lib/server/http.ts';
import { listBranches, searchBranches } from '#lib/server/github.ts';
import { getGithubAccount } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Branches of owner/name, through the given account (or anonymously, for public repos); ?search=… those starting with it. */
export const GET: RequestHandler = handler(async ({ url }) => {
	const repo = url.searchParams.get('repo');
	if (!repo) throw new BadRequest('"repo" is required');
	const accountId = url.searchParams.get('account');
	const account = accountId ? (getGithubAccount(accountId) ?? null) : null;
	const search = url.searchParams.get('search');
	return json(search ? await searchBranches(account, repo, search) : await listBranches(account, repo));
});
