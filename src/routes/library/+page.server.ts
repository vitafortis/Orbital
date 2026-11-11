import type { PageServerLoad } from './$types';
import { getReplyStyle, listAccounts, listMcpServers } from '#lib/server/store.ts';
import { DEFAULT_REPLY_STYLE } from '#lib/mcp.ts';

export const load: PageServerLoad = () => ({
	servers: listMcpServers(),
	replyStyle: getReplyStyle(),
	defaultReplyStyle: DEFAULT_REPLY_STYLE,
	// MCP servers are given to Claude Code sessions only.
	accounts: listAccounts()
		.filter((a) => a.agent === 'claude')
		.map((a) => ({ id: a.id, name: a.name }))
});
