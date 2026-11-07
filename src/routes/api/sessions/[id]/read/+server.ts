import { json } from '@sveltejs/kit';
import { BadRequest, body, handler, NotFound } from '#lib/server/http.ts';
import { readTicks, setTick } from '#lib/server/sessions/ticks.ts';
import { conversationTurns } from '#lib/server/sessions/transcripts.ts';
import { getSession } from '#lib/server/store.ts';
import type { ReadConversation } from '#lib/types.ts';
import type { RequestHandler } from './$types';

function load(id: string) {
	const s = getSession(id);
	if (!s) throw new NotFound('Session not found');
	return s;
}

/** The newest conversation (or ?conversation=<id>) as turns, for the Read tab; null before the first. */
export const GET: RequestHandler = handler(({ params, url }) => {
	const s = load(params.id);
	const c = conversationTurns(s, url.searchParams.get('conversation'));
	if (!c) return json(null);
	return json({ ...c, ticked: readTicks(s.id) } satisfies ReadConversation);
});

/** Ticks or unticks a list item: { key, done }. */
export const POST: RequestHandler = handler(async ({ params, request }) => {
	const s = load(params.id);
	const b = await body(request);
	if (typeof b.key !== 'string' || !b.key || b.key.length > 100) throw new BadRequest('"key" is required');
	return json({ ticked: setTick(s.id, b.key, b.done === true) });
});
