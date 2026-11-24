import { json } from '@sveltejs/kit';
import { canWatch } from '#lib/access.ts';
import { othersSessions } from '#lib/server/auth-config.ts';
import { handler } from '#lib/server/http.ts';
import { readTodos, systemTodos } from '#lib/server/sessions/todos.ts';
import { listSessions } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

const WEEK = 7 * 24 * 3600_000;

/**
 * The To do items (open ones, and those done in the last week) of every session you may watch,
 * and Orbital's own for you.
 */
export const GET: RequestHandler = handler(({ locals }) => {
	const since = Date.now() - WEEK;
	const others = othersSessions();
	const items = listSessions()
		.filter((s) => canWatch(locals.user, s, others))
		.flatMap((s) => readTodos(s.id).filter((t) => !t.doneAt || Date.parse(t.doneAt) > since));
	return json({ items, system: systemTodos(locals.user) });
});
