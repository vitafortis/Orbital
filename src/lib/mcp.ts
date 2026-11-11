import type { McpSecrets, McpServer } from './types.ts';

/** Notion's own MCP server, run in the session with an integration token. */
export const NOTION_PACKAGE = '@notionhq/notion-mcp-server@2.5.2';

export const MCP_NAME = /^[A-Za-z0-9_-]{1,40}$/;
/** Orbital's own server in every Claude session (the To do tool): a name the Library can't use. */
export const ORBITAL_MCP = 'orbital';
// Environment variable and header names.
export const MCP_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

type Entry = { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> } | { type: 'http'; url: string; headers?: Record<string, string> };

/** One server as Claude Code's --mcp-config expects it, or null when it can't run (no token, say). */
export function mcpEntry(s: McpServer, secrets: McpSecrets): Entry | null {
	if (s.kind === 'notion') return secrets.token ? { type: 'stdio', command: 'npx', args: ['-y', NOTION_PACKAGE], env: { NOTION_TOKEN: secrets.token } } : null;
	if (s.kind === 'stdio') return s.command ? { type: 'stdio', command: s.command, args: s.args, ...(secrets.env && Object.keys(secrets.env).length ? { env: secrets.env } : {}) } : null;
	return s.url ? { type: 'http', url: s.url, ...(secrets.headers && Object.keys(secrets.headers).length ? { headers: secrets.headers } : {}) } : null;
}

/** Whether a Claude account's sessions get this server. */
export const mcpFor = (s: McpServer, accountId: string) => s.enabled && (!s.accountIds.length || s.accountIds.includes(accountId));

/** The Library's part of a session's --mcp-config file, for a session on `accountId`. */
export function mcpConfig(servers: { server: McpServer; secrets: McpSecrets }[], accountId: string): { mcpServers: Record<string, Entry> } {
	const mcpServers: Record<string, Entry> = {};
	for (const { server, secrets } of servers) {
		if (!mcpFor(server, accountId)) continue;
		const e = mcpEntry(server, secrets);
		if (e) mcpServers[server.name] = e;
	}
	return { mcpServers };
}

/**
 * What Orbital asks of Claude's replies, added to its system prompt (--append-system-prompt):
 * the outcome first, what needs the person next, then short details; steps for the person go on
 * the To do list. Editable in the Library.
 */
export const DEFAULT_REPLY_STYLE = [
	'The user often reads your replies on a phone, between other work. Make each one quick to follow:',
	'- Start with one or two lines on the outcome: what you did or found, and whether anything is blocked.',
	'- Then, only if there is one, what you need from the user: a question or a decision, on its own line.',
	'- Then the details, as short as they can be. No recap of earlier turns, no restating the request, no closing summary.',
	'- When the user has to do something themselves (log in, run a command on their own machine, run a script, approve something), put it on their To do list with the add_todo_for_user tool, with the exact command, instead of writing it in the reply.'
].join('\n');

export type ReplyStyle = { enabled: boolean; text: string };
