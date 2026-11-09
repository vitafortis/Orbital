import { json } from '@sveltejs/kit';
import { body, handler, requireAdmin } from '#lib/server/http.ts';
import { parseMcpInput } from '#lib/server/mcp-input.ts';
import { createMcpServer, listMcpServers } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** The Library's MCP servers, without their secrets. */
export const GET: RequestHandler = handler(() => json(listMcpServers()));

/** Adds a server; admins only, since every session it applies to gets its access. */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	requireAdmin(locals);
	const { input, secrets } = await parseMcpInput(await body(request));
	return json(createMcpServer(input, secrets ?? {}), { status: 201 });
});
