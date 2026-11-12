import { redirect } from '@sveltejs/kit';
import { finishNotionConnect } from '#lib/server/notion-oauth.ts';
import { refreshSessionNotion } from '#lib/server/sessions/notion.ts';
import type { RequestHandler } from './$types';

/** Back from Notion's sign-in: save it, and show the Library with how it went. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state') ?? '';
	let to = '/settings/library?notion=connected#notion';
	if (!code) {
		to = `/settings/library?notion_error=${encodeURIComponent(url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'Notion sign-in was cancelled')}#notion`;
	} else {
		try {
			refreshSessionNotion(await finishNotionConnect(state, code, locals.user?.id ?? null));
		} catch (err) {
			to = `/settings/library?notion_error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}#notion`;
		}
	}
	redirect(303, to);
};
