import { json } from '@sveltejs/kit';
import { BadRequest, body, handler, requireAdmin } from '#lib/server/http.ts';
import { parseSkillInput } from '#lib/server/skill-input.ts';
import { syncRepoSkill } from '#lib/server/skills-library.ts';
import { createLibrarySkill, deleteLibrarySkill, listLibrarySkills } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handler(() => json(listLibrarySkills()));

/** Adds a skill; one from a repo is fetched at once, so a wrong repo, path or access shows here. */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	requireAdmin(locals);
	const s = createLibrarySkill(parseSkillInput(await body(request)));
	if (s.source !== 'repo') return json(s, { status: 201 });
	try {
		return json(await syncRepoSkill(s.id, true), { status: 201 });
	} catch (err) {
		deleteLibrarySkill(s.id);
		throw new BadRequest(err instanceof Error ? err.message : String(err));
	}
});
