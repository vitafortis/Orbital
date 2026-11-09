import { json } from '@sveltejs/kit';
import { body, handler, NotFound, requireAdmin } from '#lib/server/http.ts';
import { parseMcpInput } from '#lib/server/mcp-input.ts';
import { deleteMcpServer, getMcpServer, updateMcpServer } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

function load(id: string) {
	const s = getMcpServer(id);
	if (!s) throw new NotFound('Server not found');
	return s;
}

/** Changes a server; sessions get the change when Claude next starts. */
export const PATCH: RequestHandler = handler(async ({ params, request, locals }) => {
	requireAdmin(locals);
	const existing = load(params.id);
	const { input, secrets } = await parseMcpInput(await body(request), existing);
	updateMcpServer(existing.id, input, secrets);
	return json(getMcpServer(existing.id));
});

export const DELETE: RequestHandler = handler(({ params, locals }) => {
	requireAdmin(locals);
	load(params.id);
	deleteMcpServer(params.id);
	return json({ ok: true });
});
