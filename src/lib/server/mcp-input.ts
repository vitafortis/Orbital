import { BadRequest, str } from './http.ts';
import { notionWhoAmI } from './notion.ts';
import { getAccount, listMcpServers, type McpServerInput } from './store.ts';
import { MCP_KEY, MCP_NAME, ORBITAL_MCP } from '#lib/mcp.ts';
import type { McpSecrets, McpServer } from '#lib/types.ts';

function pairs(v: unknown, what: string): Record<string, string> | undefined {
	if (v === undefined || v === null) return undefined;
	if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequest(`${what} must be name/value pairs`);
	const out: Record<string, string> = {};
	for (const [k, val] of Object.entries(v)) {
		if (!MCP_KEY.test(k)) throw new BadRequest(`"${k}" isn't a valid ${what === 'Headers' ? 'header' : 'variable'} name`);
		if (typeof val !== 'string' || val.length > 4000) throw new BadRequest(`${k}: give a value under 4000 characters`);
		out[k] = val;
	}
	return out;
}

/**
 * An MCP server from the Library form, and its secrets when new ones were given (left out, the
 * stored ones stay). A Notion token is checked with Notion, which also names its workspace.
 */
export async function parseMcpInput(b: Record<string, unknown>, existing?: McpServer): Promise<{ input: McpServerInput; secrets?: McpSecrets }> {
	const name = str(b, 'name', { required: true, max: 40 })!;
	if (!MCP_NAME.test(name)) throw new BadRequest('A name is letters, digits, "-" and "_"');
	if (name.toLowerCase() === ORBITAL_MCP) throw new BadRequest(`"${ORBITAL_MCP}" is Orbital's own: pick another name`);
	if (listMcpServers().some((s) => s.name === name && s.id !== existing?.id)) throw new BadRequest(`There's already a server called "${name}"`);
	const kind = b.kind ?? existing?.kind;
	if (kind !== 'notion' && kind !== 'stdio' && kind !== 'http') throw new BadRequest('Pick Notion, a command or a URL');
	const accountIds = Array.isArray(b.accountIds) ? b.accountIds.filter((x): x is string => typeof x === 'string') : [];
	for (const id of accountIds) if (!getAccount(id)) throw new BadRequest('Unknown model account');
	const input: McpServerInput = { name, kind, command: null, args: [], url: null, notion: existing?.notion ?? null, accountIds, enabled: b.enabled !== false };
	let secrets: McpSecrets | undefined;

	if (kind === 'notion') {
		const token = str(b, 'token', { max: 400 });
		if (token) {
			input.notion = await notionWhoAmI(token).catch((err) => {
				throw new BadRequest(err instanceof Error ? err.message : String(err));
			});
			secrets = { token };
		} else if (!existing || existing.kind !== 'notion') throw new BadRequest('Paste the integration secret');
	} else if (kind === 'stdio') {
		input.command = str(b, 'command', { required: true, max: 200 });
		input.args = Array.isArray(b.args) ? b.args.filter((a): a is string => typeof a === 'string' && a.length <= 500).slice(0, 50) : [];
		const env = pairs(b.env, 'Environment');
		if (env) secrets = { env };
	} else {
		const url = str(b, 'url', { required: true, max: 500 })!;
		if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new BadRequest('The URL starts with https://');
		input.url = url;
		const headers = pairs(b.headers, 'Headers');
		if (headers) secrets = { headers };
	}
	// Changing what kind of server it is drops the old kind's secrets.
	if (existing && existing.kind !== kind && !secrets) secrets = {};
	return { input, secrets };
}
