import { json } from '@sveltejs/kit';
import { BadRequest, handler, requireAdmin } from '#lib/server/http.ts';
import { syncRepoSkill } from '#lib/server/skills-library.ts';
import type { RequestHandler } from './$types';

/** Fetches a repo skill again now. */
export const POST: RequestHandler = handler(async ({ params, locals }) => {
	requireAdmin(locals);
	return json(
		await syncRepoSkill(params.id, true).catch((err) => {
			throw new BadRequest(err instanceof Error ? err.message : String(err));
		})
	);
});
