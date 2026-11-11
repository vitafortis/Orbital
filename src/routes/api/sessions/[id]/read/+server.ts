import { json } from '@sveltejs/kit';
import { handler, NotFound } from '#lib/server/http.ts';
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
	return json(c satisfies ReadConversation);
});
