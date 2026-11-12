/**
 * Notion for a session, as the person who started it ("Connect my Notion", see notion-oauth.ts).
 * Claude talks to a small relay in the session (stdio MCP), which forwards each message to
 * Notion's hosted MCP server with the current token, read from .orb/notion-token every time.
 * Orbital rewrites that file when it renews the token, so a long session never has to restart
 * Claude for it, the way a token fixed in Claude's MCP config would.
 */
import { chmodSync, chownSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTION_MCP_URL, notionAccessToken } from '../notion-oauth.ts';
import { listSessions } from '../store.ts';
import type { Session } from '#lib/types.ts';
import { metaDir } from './storage.ts';

export const NOTION_BRIDGE_FILE = 'orb-notion.mjs';
const TOKEN_FILE = 'notion-token';

// Plain JavaScript for the session's node: MCP over stdio on one side, MCP's Streamable HTTP
// on the other (POST each message; the answer comes as JSON or as an event stream).
export const NOTION_BRIDGE_SCRIPT = String.raw`// Orbital's relay to Notion for this session. Written by Orbital at launch; changes are overwritten.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const URL_ = ${JSON.stringify(NOTION_MCP_URL)};
const TOKEN = '/session/.orb/${TOKEN_FILE}';
let sessionId = null;
let protocol = '2025-06-18';

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const token = () => { try { return readFileSync(TOKEN, 'utf8').trim(); } catch { return ''; } };
const fail = (id, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code: -32000, message } });

function deliver(body, contentType) {
	if (!body.trim()) return;
	if (contentType.includes('text/event-stream')) {
		for (const event of body.split(/\r?\n\r?\n/)) {
			const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
			if (data) try { emit(JSON.parse(data)); } catch {}
		}
	} else {
		try { const j = JSON.parse(body); for (const m of Array.isArray(j) ? j : [j]) emit(m); } catch {}
	}
}

function emit(m) {
	if (m && m.result && m.result.protocolVersion) protocol = m.result.protocolVersion;
	send(m);
}

async function forward(m, again = true) {
	const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token(), 'mcp-protocol-version': protocol };
	if (sessionId) headers['mcp-session-id'] = sessionId;
	let res;
	try {
		res = await fetch(URL_, { method: 'POST', headers, body: JSON.stringify(m) });
	} catch (err) {
		return fail(m.id, "Couldn't reach Notion: " + (err?.message ?? err));
	}
	// Renewed meanwhile: the file has the new token; try once more.
	if (res.status === 401 && again) { await new Promise((r) => setTimeout(r, 2000)); return forward(m, false); }
	// Notion forgot this connection's session: start a new one, then send it again.
	if (res.status === 404 && sessionId && m.method !== 'initialize' && again) { sessionId = null; return forward(m, false); }
	const sid = res.headers.get('mcp-session-id');
	if (sid) sessionId = sid;
	const body = await res.text().catch(() => '');
	if (!res.ok) {
		return fail(m.id, res.status === 401 ? 'Notion turned the sign-in down: connect Notion again in Orbital (Library → Your Notion).' : 'Notion: HTTP ' + res.status + (body ? ' ' + body.slice(0, 200) : ''));
	}
	deliver(body, res.headers.get('content-type') || '');
}

createInterface({ input: process.stdin }).on('line', (line) => {
	let m;
	try { m = JSON.parse(line); } catch { return; }
	void forward(m);
});
`;

function write(file: string, text: string, mode: number) {
	writeFileSync(file, text, { mode });
	chmodSync(file, mode);
	if (process.getuid?.() === 0) chownSync(file, 1000, 1000);
}

/**
 * Gives the session its owner's Notion (the relay and the current token), or takes it away.
 * Whether it has it now, for its MCP config.
 */
export function writeSessionNotion(s: Pick<Session, 'id' | 'ownerId'>): boolean {
	const dir = metaDir(s.id);
	const token = notionAccessToken(s.ownerId);
	if (!token) {
		rmSync(join(dir, TOKEN_FILE), { force: true });
		return false;
	}
	write(join(dir, NOTION_BRIDGE_FILE), NOTION_BRIDGE_SCRIPT, 0o644);
	write(join(dir, TOKEN_FILE), `${token}\n`, 0o600);
	return true;
}

/** After a person's token is renewed (or they disconnect): their running sessions get it at once. */
export function refreshSessionNotion(userId: string) {
	for (const s of listSessions()) {
		if (s.ownerId === userId && (s.status === 'running' || s.status === 'starting')) {
			try {
				writeSessionNotion(s);
			} catch {}
		}
	}
}
