/**
 * The Library's MCP servers, as a file Claude reads at launch (--mcp-config). In the session's
 * .orb folder with its secrets, readable by the session's user only, and rewritten at every
 * launch, so a change applies from the next start or restart of Claude.
 */
import { chmodSync, chownSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mcpConfig } from '#lib/mcp.ts';
import { getMcpSecrets, listMcpServers } from '../store.ts';
import { metaDir } from './storage.ts';

const IN_CONTAINER = '/session/.orb/mcp.json';

/** Writes (or removes) the session's MCP config; its path in the container, or null. */
export function writeSessionMcp(sessionId: string, accountId: string): string | null {
	const file = join(metaDir(sessionId), 'mcp.json');
	const config = mcpConfig(
		listMcpServers().map((server) => ({ server, secrets: getMcpSecrets(server.id) })),
		accountId
	);
	if (!config) {
		rmSync(file, { force: true });
		return null;
	}
	writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
	chmodSync(file, 0o600);
	if (process.getuid?.() === 0) chownSync(file, 1000, 1000);
	return IN_CONTAINER;
}
