/**
 * Skills and slash commands a session can start with: Claude Code's built-in ones, plus
 * the Claude account's own (skills/<name>/SKILL.md and commands/<name>.md in its config
 * folder, shared by its sessions). A repo's project skills work too; type them by name.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { abs, accountRel } from './sessions/storage.ts';
import type { SkillOption } from '#lib/types.ts';
import { librarySkillsFor } from './skills-library.ts';

export const BUILT_IN_SKILLS: SkillOption[] = [
	{ command: '/code-review', description: 'Review a pull request (or the branch’s changes) for bugs', source: 'built-in', takesPr: true },
	{ command: '/security-review', description: 'Security review of the changes on this branch', source: 'built-in' },
	{ command: '/simplify', description: 'Clean up the changed code: reuse, simplification, efficiency', source: 'built-in' },
	{ command: '/init', description: 'Write a CLAUDE.md that explains the repo to Claude', source: 'built-in' }
];

/** `description:` from a Markdown file's YAML front matter. */
export function frontMatterDescription(text: string): string {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	const d = m && /^description:\s*(.+)$/m.exec(m[1]);
	return d ? d[1].trim().replace(/^["']|["']$/g, '') : '';
}

function safeList(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

function safeRead(path: string): string {
	try {
		return readFileSync(path, 'utf8').slice(0, 8192);
	} catch {
		return '';
	}
}

export function accountSkills(accountId: string): SkillOption[] {
	const root = abs(accountRel(accountId));
	const out: SkillOption[] = [];
	for (const name of safeList(join(root, 'skills'))) {
		const text = safeRead(join(root, 'skills', name, 'SKILL.md'));
		if (text) out.push({ command: `/${name}`, description: frontMatterDescription(text), source: 'account' });
	}
	for (const file of safeList(join(root, 'commands'))) {
		if (!file.endsWith('.md')) continue;
		out.push({ command: `/${file.slice(0, -3)}`, description: frontMatterDescription(safeRead(join(root, 'commands', file))), source: 'account' });
	}
	return out.sort((a, b) => a.command.localeCompare(b.command));
}

export function skillOptions(accountId: string | null): SkillOption[] {
	// The Library's, then the account's own (installed copies of the Library's are those).
	const library: SkillOption[] = accountId ? librarySkillsFor(accountId).map((s) => ({ command: `/${s.name}`, description: s.description, source: 'library' })) : [];
	const own = accountId ? accountSkills(accountId).filter((s) => !library.some((l) => l.command === s.command)) : [];
	const seen = new Set([...library, ...own].map((s) => s.command));
	return [...BUILT_IN_SKILLS.filter((s) => !seen.has(s.command)), ...library, ...own];
}
