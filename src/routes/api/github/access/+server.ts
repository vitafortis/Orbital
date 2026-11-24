import { json } from '@sveltejs/kit';
import { BadRequest, handler } from '#lib/server/http.ts';
import { repoAccess } from '#lib/server/github.ts';
import { usableGithub } from '#lib/server/owned.ts';
import type { RequestHandler } from './$types';

/** ?repo=owner/name: what each GitHub token gets for it, the one a session should use first. */
export const GET: RequestHandler = handler(async ({ url, locals }) => {
	const repo = url.searchParams.get('repo');
	if (!repo) throw new BadRequest('Name the repository');
	return json(await repoAccess(repo, usableGithub(locals.user?.id)));
});
