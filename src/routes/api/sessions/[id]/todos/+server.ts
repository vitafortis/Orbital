import { json } from '@sveltejs/kit';
import { body, handler, NotFound, str } from '#lib/server/http.ts';
import { pokeLive } from '#lib/server/sessions/live.ts';
import { addTodo, readTodos } from '#lib/server/sessions/todos.ts';
import { getSession } from '#lib/server/store.ts';
import type { TodoWhere } from '#lib/types.ts';
import type { RequestHandler } from './$types';

const WHERE: TodoWhere[] = ['your-machine', 'session-shell', 'browser', 'other'];

function load(id: string) {
	const s = getSession(id);
	if (!s) throw new NotFound('Session not found');
	return s;
}

export const GET: RequestHandler = handler(({ params }) => json(readTodos(load(params.id).id)));

/** Adds one of your own to the session's list. */
export const POST: RequestHandler = handler(async ({ params, request }) => {
	const s = load(params.id);
	const b = await body(request);
	const where = WHERE.includes(b.where as TodoWhere) ? (b.where as TodoWhere) : 'other';
	const item = addTodo(s.id, { title: str(b, 'title', { required: true, max: 200 })!, command: str(b, 'command', { max: 4000 }), where, why: str(b, 'why', { max: 1000 }) });
	pokeLive();
	return json(item, { status: 201 });
});
