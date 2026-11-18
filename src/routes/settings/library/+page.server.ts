import type { PageServerLoad } from './$types';
import { getNotionConnection, getReplyStyle, listAccounts, listGithubAccounts, listLibrarySkills, listMcpServers } from '#lib/server/store.ts';
import { DEFAULT_REPLY_STYLE } from '#lib/mcp.ts';

export const load: PageServerLoad = ({ locals }) => ({
	// Your own Notion sign-in, for sessions you start.
	myNotion: locals.user ? (getNotionConnection(locals.user.id) ?? null) : null,
	servers: listMcpServers(),
	skills: listLibrarySkills(),
	githubAccounts: listGithubAccounts().map((a) => ({ id: a.id, label: a.label ?? a.login, login: a.login })),
	replyStyle: getReplyStyle(),
	defaultReplyStyle: DEFAULT_REPLY_STYLE,
	// MCP servers are given to Claude Code sessions only.
	accounts: listAccounts()
		.filter((a) => a.agent === 'claude')
		.map((a) => ({ id: a.id, name: a.name }))
});
