import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getReplyStyle, listAccounts, listGithubAccounts, listLibrarySkills, listMcpServers } from '#lib/server/store.ts';
import { DEFAULT_REPLY_STYLE } from '#lib/mcp.ts';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user?.role !== 'admin') redirect(303, '/settings/accounts');
	return {
	servers: listMcpServers(),
	skills: listLibrarySkills(),
	githubAccounts: listGithubAccounts().filter((a) => !a.ownerId).map((a) => ({ id: a.id, label: a.label ?? a.login, login: a.login })),
	replyStyle: getReplyStyle(),
	defaultReplyStyle: DEFAULT_REPLY_STYLE,
	// MCP servers are given to Claude Code sessions only.
	accounts: listAccounts()
		.filter((a) => a.agent === 'claude' && !a.ownerId)
		.map((a) => ({ id: a.id, name: a.name }))
	};
};
