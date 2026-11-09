import type { McpSecrets, McpServer } from './types.ts';

/** Notion's own MCP server, run in the session with an integration token. */
export const NOTION_PACKAGE = '@notionhq/notion-mcp-server@2.5.2';

export const MCP_NAME = /^[A-Za-z0-9_-]{1,40}$/;
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

/** The --mcp-config file for a session on `accountId`, or null when it gets no servers. */
export function mcpConfig(servers: { server: McpServer; secrets: McpSecrets }[], accountId: string): { mcpServers: Record<string, Entry> } | null {
	const mcpServers: Record<string, Entry> = {};
	for (const { server, secrets } of servers) {
		if (!mcpFor(server, accountId)) continue;
		const e = mcpEntry(server, secrets);
		if (e) mcpServers[server.name] = e;
	}
	return Object.keys(mcpServers).length ? { mcpServers } : null;
}
