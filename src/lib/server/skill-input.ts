import { BadRequest, str } from './http.ts';
import { SKILL_NAME } from './skills-library.ts';
import { getAccount, getGithubAccount, listLibrarySkills, type LibrarySkillInput } from './store.ts';
import { frontMatterDescription } from './skills.ts';
import type { LibrarySkill } from '#lib/types.ts';

/** A Library skill from the form: written here (its SKILL.md), or a folder in a GitHub repo. */
export function parseSkillInput(b: Record<string, unknown>, existing?: LibrarySkill): LibrarySkillInput {
	const name = (str(b, 'name', { required: true, max: 64 }) ?? '').replace(/^\//, '').toLowerCase();
	if (!SKILL_NAME.test(name)) throw new BadRequest('A skill name is lowercase letters, digits and "-", e.g. appsec-pr-review');
	if (listLibrarySkills().some((s) => s.name === name && s.id !== existing?.id)) throw new BadRequest(`The Library already has /${name}`);
	const source = b.source === 'repo' ? 'repo' : 'here';
	const accountIds = Array.isArray(b.accountIds) ? b.accountIds.filter((x): x is string => typeof x === 'string') : [];
	for (const id of accountIds) if (!getAccount(id)) throw new BadRequest('Unknown model account');
	const base = { name, source, accountIds, enabled: b.enabled !== false } as const;
	if (source === 'here') {
		const body = typeof b.body === 'string' ? b.body.replace(/\r\n/g, '\n') : '';
		if (!body.trim()) throw new BadRequest('Write the skill (its SKILL.md)');
		if (body.length > 100_000) throw new BadRequest('Keep a skill under 100,000 characters');
		const description = str(b, 'description', { max: 1000 }) ?? frontMatterDescription(body);
		if (!description) throw new BadRequest('Give it a description: Claude uses it to know when the skill applies');
		return { ...base, description, body, repo: null, ref: null, path: null, githubAccountId: null };
	}
	const repo = str(b, 'repo', { required: true, max: 140 })!.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
	if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new BadRequest('Enter the repository as owner/name');
	const path = str(b, 'path', { max: 300 }) ?? `.claude/skills/${name}`;
	if (path.split('/').includes('..')) throw new BadRequest('Not a path in the repo');
	const githubAccountId = str(b, 'githubAccountId', { max: 80 });
	if (githubAccountId && !getGithubAccount(githubAccountId)) throw new BadRequest('Unknown GitHub connection');
	return { ...base, description: str(b, 'description', { max: 1000 }) ?? '', body: null, repo, ref: str(b, 'ref', { max: 200 }), path, githubAccountId };
}
