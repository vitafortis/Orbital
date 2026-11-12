import { json } from '@sveltejs/kit';
import { handler, Forbidden } from '#lib/server/http.ts';
import { disconnectNotion, startNotionConnect } from '#lib/server/notion-oauth.ts';
import { refreshSessionNotion } from '#lib/server/sessions/notion.ts';
import { getSettings } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

function me(locals: App.Locals): string {
	if (!locals.user) throw new Forbidden('Sign in to connect your Notion');
	return locals.user.id;
}

/** Where to send your browser to sign in to Notion; it comes back to Orbital (the public URL, or this address). */
export const POST: RequestHandler = handler(async ({ locals }) => json({ url: await startNotionConnect(me(locals), getSettings().publicUrl || locals.origin) }));

/** Forgets your Notion sign-in; your running sessions lose it at once. */
export const DELETE: RequestHandler = handler(async ({ locals }) => {
	const id = me(locals);
	await disconnectNotion(id);
	refreshSessionNotion(id);
	return json({ ok: true });
});
