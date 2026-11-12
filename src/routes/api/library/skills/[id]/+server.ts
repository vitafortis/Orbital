import { json } from '@sveltejs/kit';
import { body, handler, NotFound, requireAdmin } from '#lib/server/http.ts';
import { parseSkillInput } from '#lib/server/skill-input.ts';
import { syncRepoSkill } from '#lib/server/skills-library.ts';
import { deleteLibrarySkill, getLibrarySkill, updateLibrarySkill } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

function load(id: string) {
	const s = getLibrarySkill(id);
	if (!s) throw new NotFound('Skill not found');
	return s;
}

/** Changes a skill; sessions get the change when Claude next starts. */
export const PATCH: RequestHandler = handler(async ({ params, request, locals }) => {
	requireAdmin(locals);
	const s = load(params.id);
	const input = parseSkillInput(await body(request), s);
	updateLibrarySkill(s.id, input);
	const moved = input.source === 'repo' && (input.repo !== s.repo || input.ref !== s.ref || input.path !== s.path || input.githubAccountId !== s.githubAccountId);
	if (moved) await syncRepoSkill(s.id, true).catch(() => {});
	return json(getLibrarySkill(s.id));
});

export const DELETE: RequestHandler = handler(({ params, locals }) => {
	requireAdmin(locals);
	load(params.id);
	deleteLibrarySkill(params.id);
	return json({ ok: true });
});
