import { json } from '@sveltejs/kit';
import { handler } from '#lib/server/http.ts';
import { readTodos, systemTodos } from '#lib/server/sessions/todos.ts';
import { listSessions } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

const WEEK = 7 * 24 * 3600_000;

/** Every session's To do items (open ones, and those done in the last week), and Orbital's own. */
export const GET: RequestHandler = handler(() => {
	const since = Date.now() - WEEK;
	const items = listSessions().flatMap((s) => readTodos(s.id).filter((t) => !t.doneAt || Date.parse(t.doneAt) > since));
	return json({ items, system: systemTodos() });
});
