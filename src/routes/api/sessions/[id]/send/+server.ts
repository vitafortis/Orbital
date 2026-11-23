import { json } from '@sveltejs/kit';
import { BadRequest, body, handler } from '#lib/server/http.ts';
import { pokeLive } from '#lib/server/sessions/live.ts';
import { sendToSession } from '#lib/server/sessions/runtime.ts';
import { touchSession } from '#lib/server/sessions/expiry.ts';
import type { RequestHandler } from './$types';

// Keys the quick-reply bar can press, by tmux name.
const KEYS = new Set(['Enter', 'Escape', 'Tab', 'BTab', 'Up', 'Down', 'Left', 'Right', 'C-c', 'C-d', 'y', 'n', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

/** Types into the session without opening its terminal (quick replies from the overview). */
export const POST: RequestHandler = handler(async ({ params, request }) => {
	const b = await body(request);
	const text = typeof b.text === 'string' ? b.text : '';
	if (text.length > 20_000) throw new BadRequest('That message is too long');
	const keys = Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === 'string') : [];
	if (keys.some((k) => !KEYS.has(k))) throw new BadRequest('Unknown key');
	if (!text && !keys.length && !b.enter) throw new BadRequest('Nothing to send');
	await sendToSession(params.id, { text, keys, enter: b.enter === true });
	touchSession(params.id);
	setTimeout(pokeLive, 400);
	return json({ ok: true });
});
