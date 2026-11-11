import { json } from '@sveltejs/kit';
import { BadRequest, body, handler, requireAdmin } from '#lib/server/http.ts';
import { getReplyStyle, setReplyStyle } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** How Claude is asked to write its replies, from the next launch of each session. */
export const PUT: RequestHandler = handler(async ({ request, locals }) => {
	requireAdmin(locals);
	const b = await body(request);
	const text = typeof b.text === 'string' ? b.text : '';
	if (text.length > 4000) throw new BadRequest('Keep it under 4000 characters');
	setReplyStyle({ enabled: b.enabled !== false, text });
	return json(getReplyStyle());
});
