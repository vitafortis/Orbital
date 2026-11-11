/**
 * Orbital's own MCP server, given to every Claude session: a tool to put things the person
 * has to do (log in, run a command on their machine, approve something) on the session's To do
 * list, instead of leaving them in a long reply. Written into the session's .orb folder at
 * launch and run with the image's node, so it needs no session image change and no network:
 * items are appended to .orb/todos.jsonl, which Orbital reads, and Orbital marks them done
 * in .orb/todos-state.json, which the tool reads back.
 */

export const ORB_MCP_FILE = 'orb-mcp.mjs';

const TOOL_DESCRIPTION =
	"Put something the user has to do themselves on their To do list in Orbital: an interactive login (aws sso login, gh auth login), a command that needs their credentials or their own machine, a script for them to run, an approval or a decision outside this conversation. Use it whenever you would otherwise ask them to run something, with the exact command, instead of leaving it in your reply. Then carry on with what you can; Orbital tells you when they mark it done, and list_todos_for_user shows what's still open. Don't use it for things you can do yourself.";

// Plain JavaScript for the session's node, in one string: no dependencies, newline-delimited
// JSON-RPC on stdin and stdout (MCP's stdio transport).
export const ORB_MCP_SCRIPT = String.raw`// Orbital's To do tool for this session. Written by Orbital at launch; changes are overwritten.
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const DIR = '/session/.orb';
const WHERE = ['your-machine', 'session-shell', 'browser', 'other'];
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const text = (t, isError) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

function items() {
	let lines = [];
	try { lines = readFileSync(DIR + '/todos.jsonl', 'utf8').split('\n'); } catch {}
	let state = {};
	try { state = JSON.parse(readFileSync(DIR + '/todos-state.json', 'utf8')); } catch {}
	const out = [];
	for (const l of lines) {
		try { const t = JSON.parse(l); if (t && t.id && t.title) out.push({ ...t, doneAt: state[t.id]?.doneAt ?? null }); } catch {}
	}
	return out;
}

const TOOLS = [
	{
		name: 'add_todo_for_user',
		description: ${JSON.stringify(TOOL_DESCRIPTION)},
		inputSchema: {
			type: 'object',
			properties: {
				title: { type: 'string', description: 'What to do, short and specific, e.g. "Log in to AWS SSO for staging".' },
				command: { type: 'string', description: 'The exact command to run, if there is one, e.g. "aws sso login --profile staging".' },
				where: { type: 'string', enum: WHERE, description: "Where: your-machine (their own computer), session-shell (this session's Shell tab in Orbital), browser, or other." },
				why: { type: 'string', description: 'One sentence on why you need it, and what you will do once it is done.' }
			},
			required: ['title']
		}
	},
	{
		name: 'list_todos_for_user',
		description: "The items on the user's To do list for this session, and which are done.",
		inputSchema: { type: 'object', properties: {} }
	}
];

function call(name, args) {
	if (name === 'add_todo_for_user') {
		const title = String(args?.title ?? '').trim().slice(0, 200);
		if (!title) return text('A title is required.', true);
		const item = {
			id: randomUUID(),
			title,
			command: args?.command ? String(args.command).slice(0, 4000) : null,
			where: WHERE.includes(args?.where) ? args.where : 'other',
			why: args?.why ? String(args.why).slice(0, 1000) : null,
			source: 'agent',
			at: new Date().toISOString()
		};
		appendFileSync(DIR + '/todos.jsonl', JSON.stringify(item) + '\n');
		return text('Added to the user\'s To do list: "' + title + '". Carry on with what you can; you will be told when it is done.');
	}
	if (name === 'list_todos_for_user') {
		const all = items();
		if (!all.length) return text('The To do list is empty.');
		return text(all.map((t) => (t.doneAt ? '[done] ' : '[open] ') + t.title + (t.command ? ' (' + t.command + ')' : '')).join('\n'));
	}
	return text('Unknown tool: ' + name, true);
}

createInterface({ input: process.stdin }).on('line', (line) => {
	let m;
	try { m = JSON.parse(line); } catch { return; }
	if (m.id === undefined) return; // notifications
	try {
		if (m.method === 'initialize') {
			send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'orbital', version: '1' } } });
		} else if (m.method === 'tools/list') {
			send({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
		} else if (m.method === 'tools/call') {
			send({ jsonrpc: '2.0', id: m.id, result: call(m.params?.name, m.params?.arguments) });
		} else if (m.method === 'ping') {
			send({ jsonrpc: '2.0', id: m.id, result: {} });
		} else {
			send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found: ' + m.method } });
		}
	} catch (err) {
		send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: String(err?.message ?? err) } });
	}
});
`;
