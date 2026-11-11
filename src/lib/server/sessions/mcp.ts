/**
 * The MCP servers a Claude session gets, as a file Claude reads at launch (--mcp-config):
 * Orbital's own (the To do tool, see orb-mcp.ts) and the Library's. In the session's .orb
 * folder with their secrets, readable by the session's user only, and rewritten at every
 * launch, so a change applies from the next start or restart of Claude.
 */
import { chmodSync, chownSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mcpConfig, ORBITAL_MCP } from '#lib/mcp.ts';
import { getMcpSecrets, listMcpServers } from '../store.ts';
import { ORB_MCP_FILE, ORB_MCP_SCRIPT } from './orb-mcp.ts';
import { metaDir } from './storage.ts';

const IN_CONTAINER = '/session/.orb';

function write(file: string, text: string, mode: number) {
	writeFileSync(file, text, { mode });
	chmodSync(file, mode);
	if (process.getuid?.() === 0) chownSync(file, 1000, 1000);
}

/** Writes the session's MCP config (and Orbital's tool); its path in the container. */
export function writeSessionMcp(sessionId: string, accountId: string): string {
	const dir = metaDir(sessionId);
	write(join(dir, ORB_MCP_FILE), ORB_MCP_SCRIPT, 0o644);
	const config = mcpConfig(
		listMcpServers().map((server) => ({ server, secrets: getMcpSecrets(server.id) })),
		accountId
	);
	config.mcpServers[ORBITAL_MCP] = { type: 'stdio', command: 'node', args: [`${IN_CONTAINER}/${ORB_MCP_FILE}`] };
	write(join(dir, 'mcp.json'), JSON.stringify(config, null, 2), 0o600);
	return `${IN_CONTAINER}/mcp.json`;
}
