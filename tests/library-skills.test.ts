import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_DATA_DIR = dataDir;
process.env.ORB_SESSIONS_DIR = join(dataDir, 'sessions');
process.env.ORB_SECRET_KEY = 'test-key';
const store = await import('#lib/server/store.ts');
const lib = await import('#lib/server/skills-library.ts');
const { skillOptions } = await import('#lib/server/skills.ts');
const { abs, accountRel } = await import('#lib/server/sessions/storage.ts');

const skillsDir = (acct: string) => abs(`${accountRel(acct)}/skills`);
const b64 = (s: string) => Buffer.from(s).toString('base64');

test('normalizeSkillMd: the command is the Library name, with a description', () => {
	assert.equal(lib.normalizeSkillMd('appsec', '---\nname: old\ndescription: Reviews PRs\n---\nBody', ''), '---\nname: appsec\ndescription: Reviews PRs\n---\nBody');
	assert.equal(lib.normalizeSkillMd('appsec', 'Just text', 'Reviews PRs'), '---\nname: appsec\ndescription: Reviews PRs\n---\n\nJust text');
	assert.equal(lib.normalizeSkillMd('x', '---\nallowed-tools: Read\n---\nB', 'D'), '---\nname: x\nallowed-tools: Read\ndescription: D\n---\nB');
});

test("a repo's skill folder is fetched from its default branch and installed for the account, and kept in step", async () => {
	let sha = 'c1';
	let downloads = 0;
	const real = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const u = new URL(String(input));
		const p = decodeURIComponent(u.pathname);
		if (p === '/repos/Ironclad/ironclad') return Response.json({ default_branch: 'main' });
		if (p === '/repos/Ironclad/ironclad/commits') return Response.json(u.searchParams.get('sha') === 'main' ? [{ sha }] : []);
		if (p === '/repos/Ironclad/ironclad/contents/.claude/skills/appsec-pr-review') {
			downloads++;
			return Response.json([
				{ type: 'file', path: '.claude/skills/appsec-pr-review/SKILL.md', size: 40 },
				{ type: 'dir', path: '.claude/skills/appsec-pr-review/scripts', size: 0 }
			]);
		}
		if (p === '/repos/Ironclad/ironclad/contents/.claude/skills/appsec-pr-review/SKILL.md') return Response.json({ type: 'file', path: '.claude/skills/appsec-pr-review/SKILL.md', size: 40, content: b64(`---\nname: appsec-pr-review\ndescription: AppSec review\n---\nReview ${sha}`) });
		if (p === '/repos/Ironclad/ironclad/contents/.claude/skills/appsec-pr-review/scripts') return Response.json([{ type: 'file', path: '.claude/skills/appsec-pr-review/scripts/check.sh', size: 9, content: b64('echo ok\n') }]);
		if (p === '/repos/Ironclad/ironclad/contents/docs/review.md') return Response.json({ type: 'file', path: 'docs/review.md', size: 5, content: b64('Do it') });
		return Response.json({ message: 'Not Found' }, { status: 404 });
	}) as typeof fetch;

	const base = { description: '', body: null, ref: null, githubAccountId: null, accountIds: [] as string[], enabled: true };
	const s = store.createLibrarySkill({ ...base, name: 'appsec-pr-review', source: 'repo', repo: 'Ironclad/ironclad', path: '.claude/skills/appsec-pr-review' });
	const synced = await lib.syncRepoSkill(s.id);
	assert.deepEqual({ ...synced.synced, at: '' }, { sha: 'c1', at: '', files: 2, error: null });
	assert.equal(synced.description, 'AppSec review', "the skill's own description");

	assert.deepEqual(await lib.installLibrarySkills('acct-1'), []);
	const dir = join(skillsDir('acct-1'), 'appsec-pr-review');
	assert.match(readFileSync(join(dir, 'SKILL.md'), 'utf8'), /^---\nname: appsec-pr-review\ndescription: AppSec review\n---\nReview c1$/);
	assert.equal(readFileSync(join(dir, 'scripts/check.sh'), 'utf8'), 'echo ok\n');

	// The branch didn't move: nothing downloaded again. It moved: the new version.
	await lib.syncRepoSkill(s.id);
	assert.equal(downloads, 1);
	sha = 'c2';
	await lib.syncRepoSkill(s.id);
	await lib.installLibrarySkills('acct-1');
	assert.match(readFileSync(join(dir, 'SKILL.md'), 'utf8'), /Review c2$/);
	assert.equal(downloads, 2);

	// A hand-made skill of the same name in another account is left alone; one .md file works as a skill.
	mkdirSync(join(skillsDir('acct-2'), 'appsec-pr-review'), { recursive: true });
	writeFileSync(join(skillsDir('acct-2'), 'appsec-pr-review', 'SKILL.md'), 'mine');
	const one = store.createLibrarySkill({ ...base, name: 'review-guide', source: 'repo', repo: 'Ironclad/ironclad', path: 'docs/review.md', description: 'How we review' });
	await lib.syncRepoSkill(one.id);
	const problems = await lib.installLibrarySkills('acct-2');
	assert.match(problems.join(), /appsec-pr-review: the account already has its own skill/);
	assert.equal(readFileSync(join(skillsDir('acct-2'), 'appsec-pr-review', 'SKILL.md'), 'utf8'), 'mine');
	assert.equal(readFileSync(join(skillsDir('acct-2'), 'review-guide', 'SKILL.md'), 'utf8'), '---\nname: review-guide\ndescription: How we review\n---\n\nDo it');

	// Run a skill lists the Library's.
	assert.deepEqual(skillOptions('acct-1').filter((o) => o.source === 'library').map((o) => o.command), ['/appsec-pr-review', '/review-guide']);

	// Removed from the Library (or not for this account any more): taken out of the account's skills.
	store.deleteLibrarySkill(one.id);
	store.updateLibrarySkill(s.id, { ...base, name: 'appsec-pr-review', source: 'repo', repo: 'Ironclad/ironclad', path: '.claude/skills/appsec-pr-review', accountIds: ['acct-9'] });
	await lib.installLibrarySkills('acct-1');
	assert.equal(existsSync(dir), false);

	// A path that isn't there says so, and keeps the last good copy.
	store.updateLibrarySkill(s.id, { ...base, name: 'appsec-pr-review', source: 'repo', repo: 'Ironclad/ironclad', path: 'nope', accountIds: [] });
	await assert.rejects(lib.syncRepoSkill(s.id, true), /has no nope on main/);
	assert.match(store.getLibrarySkill(s.id)!.synced!.error!, /has no nope/);
	globalThis.fetch = real;
});
