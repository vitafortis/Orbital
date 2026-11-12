/**
 * The Library's skills, installed into each Claude account's skills folder (CLAUDE_CONFIG_DIR's
 * skills/<name>/, shared by the account's sessions) whenever one of its sessions starts. Repo
 * skills are fetched from their branch first, when it has moved since the last fetch. Orbital
 * keeps a list of what it installed (skills/.orbital-library.json): it removes only those, and
 * never overwrites a skill someone made by hand under the same name.
 */
import { chownSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fetchRepoFolder } from './github.ts';
import { BadRequest } from './http.ts';
import { abs, accountRel, ensureDirs } from './sessions/storage.ts';
import { getGithubAccount, getLibrarySkill, getLibrarySkillFiles, listLibrarySkills, setLibrarySkillDescription, setLibrarySkillFiles } from './store.ts';
import type { LibrarySkill } from '#lib/types.ts';

export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MANIFEST = '.orbital-library.json';

/** A SKILL.md with the Library's name in its front matter (Claude takes the command from it), and a description. */
export function normalizeSkillMd(name: string, text: string, description: string): string {
	const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (!fm) return `---\nname: ${name}\ndescription: ${description || name}\n---\n\n${text.trimStart()}`;
	const lines = fm[1].split(/\r?\n/).filter((l) => !/^name\s*:/.test(l));
	if (!lines.some((l) => /^description\s*:/.test(l))) lines.push(`description: ${description || name}`);
	return `---\nname: ${name}\n${lines.join('\n')}\n---\n${text.slice(fm[0].length)}`;
}

const forAccount = (s: LibrarySkill, accountId: string) => s.enabled && (!s.accountIds.length || s.accountIds.includes(accountId));

/** The Library's skills a Claude account's sessions get. */
export const librarySkillsFor = (accountId: string) => listLibrarySkills().filter((s) => forAccount(s, accountId));

/** Fetches a repo skill again if its branch moved (or always, with `force`). Throws why it couldn't. */
export async function syncRepoSkill(id: string, force = false): Promise<LibrarySkill> {
	const s = getLibrarySkill(id);
	if (!s || s.source !== 'repo' || !s.repo || !s.path) throw new BadRequest('Not a skill from a repo');
	const account = s.githubAccountId ? (getGithubAccount(s.githubAccountId) ?? null) : null;
	try {
		const r = await fetchRepoFolder(account, s.repo, s.path, s.ref, force ? null : (s.synced?.sha ?? null));
		if (r.files) {
			const files = Object.fromEntries(Object.entries(r.files).map(([p, b]) => [p, b.toString('base64')]));
			setLibrarySkillFiles(id, { sha: r.sha, at: new Date().toISOString(), files: Object.keys(files).length, error: null }, files);
			// No description given: the skill's own, from its front matter.
			const md = r.files['SKILL.md'] ?? Object.entries(r.files).find(([p]) => p.toLowerCase().endsWith('.md'))?.[1];
			const own = md && /^---\r?\n[\s\S]*?^description:\s*(.+?)\s*$/m.exec(md.toString('utf8'))?.[1]?.replace(/^["']|["']$/g, '');
			if (!s.description && own) setLibrarySkillDescription(id, own);
		} else setLibrarySkillFiles(id, { ...s.synced!, at: new Date().toISOString(), error: null });
	} catch (err) {
		setLibrarySkillFiles(id, { sha: s.synced?.sha ?? null, files: s.synced?.files ?? 0, at: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) });
		throw err;
	}
	return getLibrarySkill(id)!;
}

/** The files to install for a skill: its SKILL.md (named as in the Library) and, from a repo, the rest of its folder. */
function skillFiles(s: LibrarySkill): Record<string, Buffer> {
	if (s.source === 'here') return { 'SKILL.md': Buffer.from(normalizeSkillMd(s.name, s.body ?? '', s.description)) };
	const files = Object.fromEntries(Object.entries(getLibrarySkillFiles(s.id)).map(([p, b]) => [p, Buffer.from(b, 'base64')]));
	// One .md file rather than a folder (a command, say): that's the skill.
	const md = Object.keys(files).filter((p) => p.toLowerCase().endsWith('.md'));
	if (!files['SKILL.md'] && md.length === 1) {
		files['SKILL.md'] = files[md[0]];
		delete files[md[0]];
	}
	if (!files['SKILL.md']) return {};
	files['SKILL.md'] = Buffer.from(normalizeSkillMd(s.name, files['SKILL.md'].toString('utf8'), s.description));
	return files;
}

const SYNC_EVERY = 2 * 60_000;

/**
 * Installs the Library's skills for a Claude account (before one of its sessions starts):
 * repo skills fetched if their branch moved, skills no longer in the Library for it removed.
 * What it skipped, and why.
 */
export async function installLibrarySkills(accountId: string): Promise<string[]> {
	const want = librarySkillsFor(accountId);
	const problems: string[] = [];
	await Promise.all(
		want
			.filter((s) => s.source === 'repo' && (!s.synced || Date.now() - Date.parse(s.synced.at) > SYNC_EVERY))
			.map((s) => syncRepoSkill(s.id).catch((err) => problems.push(`${s.name}: ${err instanceof Error ? err.message : err} (using the last fetched copy, if any)`)))
	);
	const rel = `${accountRel(accountId)}/skills`;
	ensureDirs(rel);
	const dir = abs(rel);
	let installed: string[] = [];
	try {
		installed = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
	} catch {}
	const now: string[] = [];
	for (const s of want.map((x) => getLibrarySkill(x.id)!)) {
		const target = join(dir, s.name);
		if (existsSync(target) && !installed.includes(s.name)) {
			problems.push(`${s.name}: the account already has its own skill by that name; left as it is`);
			continue;
		}
		const files = skillFiles(s);
		if (!files['SKILL.md']) {
			problems.push(`${s.name}: no SKILL.md yet`);
			continue;
		}
		rmSync(target, { recursive: true, force: true });
		for (const [p, data] of Object.entries(files)) {
			const file = normalize(join(target, p));
			if (!file.startsWith(target + '/')) continue;
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, data, { mode: 0o644 });
		}
		now.push(s.name);
	}
	for (const name of installed) if (!now.includes(name) && !want.some((s) => s.name === name)) rmSync(join(dir, name), { recursive: true, force: true });
	writeFileSync(join(dir, MANIFEST), JSON.stringify(now));
	if (process.getuid?.() === 0) chownTree(dir);
	return problems;
}

/** Run as root (in development), hand what was written to the session user, like ensureDirs does. */
function chownTree(dir: string) {
	const walk = (p: string) => {
		chownSync(p, 1000, 1000);
		if (statSync(p).isDirectory()) for (const c of readdirSync(p)) walk(join(p, c));
	};
	walk(join(dir, MANIFEST));
	for (const name of JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as string[]) walk(join(dir, name));
}
