import { json } from '@sveltejs/kit';
import { body, handler, NotFound } from '#lib/server/http.ts';
import { pokeLive } from '#lib/server/sessions/live.ts';
import { sendToSession } from '#lib/server/sessions/runtime.ts';
import { setTodoDone } from '#lib/server/sessions/todos.ts';
import { getSession } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/**
 * Marks an item done (or not). With `tell`, a running agent hears about it too, so it can carry
 * on without you typing it; it can also check with its list_todos_for_user tool.
 */
export const PATCH: RequestHandler = handler(async ({ params, request }) => {
	const s = getSession(params.id);
	if (!s) throw new NotFound('Session not found');
	const b = await body(request);
	const done = b.done !== false;
	const item = setTodoDone(s.id, params.todoId, done);
	if (!item) throw new NotFound('No such item');
	let told = false;
	if (done && b.tell === true && s.status === 'running') {
		await sendToSession(s.id, { text: `Done: ${item.title}`, enter: true });
		told = true;
	}
	pokeLive();
	return json({ item, told });
});
