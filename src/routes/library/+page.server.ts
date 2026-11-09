import type { PageServerLoad } from './$types';
import { listAccounts, listMcpServers } from '#lib/server/store.ts';

export const load: PageServerLoad = () => ({
	servers: listMcpServers(),
	// MCP servers are given to Claude Code sessions only.
	accounts: listAccounts()
		.filter((a) => a.agent === 'claude')
		.map((a) => ({ id: a.id, name: a.name }))
});
