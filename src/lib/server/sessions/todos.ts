/**
 * A session's To do list: what its agent added (Orbital's add_todo_for_user tool, see
 * orb-mcp.ts) or you did, in .orb/todos.jsonl, and which are done, in .orb/todos-state.json,
 * which the tool reads back. Plus what Orbital itself knows needs a person.
 */
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { listAccounts, listAwsLogins } from '../store.ts';
import { metaDir } from './storage.ts';
import type { SystemTodo, TodoItem, TodoWhere } from '#lib/types.ts';

const WHERE: TodoWhere[] = ['your-machine', 'session-shell', 'browser', 'other'];
const itemsFile = (id: string) => join(metaDir(id), 'todos.jsonl');
const stateFile = (id: string) => join(metaDir(id), 'todos-state.json');

type State = Record<string, { doneAt: string | null }>;

function readState(sessionId: string): State {
	try {
		const v = JSON.parse(readFileSync(stateFile(sessionId), 'utf8'));
		return v && typeof v === 'object' ? (v as State) : {};
	} catch {
		return {};
	}
}

const cache = new Map<string, { key: string; items: TodoItem[] }>();
const mtime = (f: string) => (existsSync(f) ? `${statSync(f).mtimeMs}:${statSync(f).size}` : '-');

/** The session's items, oldest first; lines it can't read are skipped (the agent writes them). */
export function readTodos(sessionId: string): TodoItem[] {
	const key = `${mtime(itemsFile(sessionId))}|${mtime(stateFile(sessionId))}`;
	const hit = cache.get(sessionId);
	if (hit?.key === key) return hit.items;
	let lines: string[] = [];
	try {
		lines = readFileSync(itemsFile(sessionId), 'utf8').split('\n');
	} catch {}
	const state = readState(sessionId);
	const items: TodoItem[] = [];
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const t = JSON.parse(line) as Partial<TodoItem>;
			if (typeof t.id !== 'string' || typeof t.title !== 'string') continue;
			items.push({
				id: t.id,
				sessionId,
				title: t.title.slice(0, 200),
				command: typeof t.command === 'string' && t.command ? t.command : null,
				where: WHERE.includes(t.where as TodoWhere) ? (t.where as TodoWhere) : 'other',
				why: typeof t.why === 'string' && t.why ? t.why : null,
				source: t.source === 'you' ? 'you' : 'agent',
				at: typeof t.at === 'string' ? t.at : new Date(0).toISOString(),
				doneAt: state[t.id]?.doneAt ?? null
			});
		} catch {}
	}
	cache.set(sessionId, { key, items });
	return items;
}

export const openTodos = (sessionId: string) => readTodos(sessionId).filter((t) => !t.doneAt);

/** Adds one of your own. */
export function addTodo(sessionId: string, input: { title: string; command: string | null; where: TodoWhere; why: string | null }): TodoItem {
	const item = { id: randomUUID(), ...input, source: 'you' as const, at: new Date().toISOString() };
	appendFileSync(itemsFile(sessionId), `${JSON.stringify(item)}\n`);
	return { ...item, sessionId, doneAt: null };
}

export function setTodoDone(sessionId: string, id: string, done: boolean): TodoItem | undefined {
	const item = readTodos(sessionId).find((t) => t.id === id);
	if (!item) return undefined;
	const state = readState(sessionId);
	state[id] = { doneAt: done ? new Date().toISOString() : null };
	writeFileSync(stateFile(sessionId), JSON.stringify(state));
	return readTodos(sessionId).find((t) => t.id === id);
}

/** What Orbital itself knows needs a person: signed-out model accounts, ended AWS sign-ins. */
export function systemTodos(now = Date.now()): SystemTodo[] {
	const out: SystemTodo[] = [];
	for (const a of listAccounts()) {
		if (a.status === 'signed_out') out.push({ id: `account:${a.id}`, title: `Sign in to ${a.name} again`, why: "Its sessions can't start the agent until it's signed in.", href: '/settings/accounts' });
	}
	for (const l of listAwsLogins()) {
		if (!l.renewable && l.expiresAt && Date.parse(l.expiresAt) < now) {
			out.push({ id: `aws:${l.id}`, title: `Sign in to AWS SSO again: ${l.label ?? new URL(l.startUrl).hostname}`, why: 'Sessions using its profiles get no new AWS credentials until then.', href: '/settings/accounts#aws' });
		}
	}
	return out;
}
