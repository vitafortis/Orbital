import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_DATA_DIR = dataDir;
process.env.ORB_SESSIONS_DIR = join(dataDir, 'sessions');
process.env.ORB_SECRET_KEY = 'test-key';
const store = await import('#lib/server/store.ts');
const notion = await import('#lib/server/notion-oauth.ts');
const { writeSessionMcp } = await import('#lib/server/sessions/mcp.ts');
const { NOTION_BRIDGE_SCRIPT } = await import('#lib/server/sessions/notion.ts');
const { ensureDirs, metaDir } = await import('#lib/server/sessions/storage.ts');

type Call = { url: URL; body: string };
function fakeNotion(handler: (c: Call) => Response) {
	const calls: Call[] = [];
	const real = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const c = { url: new URL(String(input)), body: init?.body ? String(init.body) : '' };
		calls.push(c);
		return handler(c);
	}) as typeof fetch;
	return { calls, restore: () => (globalThis.fetch = real) };
}

const META = { authorization_endpoint: 'https://mcp.notion.com/authorize', token_endpoint: 'https://mcp.notion.com/token', registration_endpoint: 'https://mcp.notion.com/register', revocation_endpoint: 'https://mcp.notion.com/token' };

test("connecting your Notion: Orbital registers, sends you with PKCE, keeps your tokens and renews them", async () => {
	let n = 0;
	const nb = fakeNotion((c) => {
		if (c.url.pathname === '/.well-known/oauth-authorization-server') return Response.json(META);
		if (c.url.pathname === '/register') return Response.json({ client_id: 'orb-client' });
		if (c.url.pathname === '/token') {
			const f = new URLSearchParams(c.body);
			if (f.get('grant_type') === 'authorization_code') return Response.json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 60 });
			if (f.get('grant_type') === 'refresh_token') return Response.json({ access_token: `at-${++n + 1}`, refresh_token: 'rt-2', expires_in: 3600 });
			return Response.json({});
		}
		return new Response('', { status: 404 });
	});
	const url = new URL(await notion.startNotionConnect('u1', 'https://orbital.example/'));
	assert.equal(url.origin + url.pathname, 'https://mcp.notion.com/authorize');
	assert.equal(url.searchParams.get('client_id'), 'orb-client');
	assert.equal(url.searchParams.get('redirect_uri'), 'https://orbital.example/api/notion/callback');
	assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
	assert.equal(url.searchParams.get('resource'), 'https://mcp.notion.com/mcp');
	assert.deepEqual(JSON.parse(nb.calls.find((c) => c.url.pathname === '/register')!.body).redirect_uris, ['https://orbital.example/api/notion/callback']);
	const state = url.searchParams.get('state')!;

	// Finished by someone else: refused, and the sign-in can't be reused.
	await assert.rejects(notion.finishNotionConnect(state, 'code-1', 'u2'), /started by someone else/);
	await assert.rejects(notion.finishNotionConnect(state, 'code-1', 'u1'), /expired/);

	const again = new URL(await notion.startNotionConnect('u1', 'https://orbital.example'));
	assert.equal(nb.calls.filter((c) => c.url.pathname === '/register').length, 1, 'registered once per address');
	await notion.finishNotionConnect(again.searchParams.get('state')!, 'code-2', 'u1');
	const exchange = new URLSearchParams(nb.calls.find((c) => c.url.pathname === '/token')!.body);
	assert.equal(exchange.get('code'), 'code-2');
	// The verifier is the one the challenge was made from.
	assert.equal(createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url'), again.searchParams.get('code_challenge'));
	assert.equal(notion.notionAccessToken('u1'), 'at-1');
	assert.equal(notion.notionAccessToken('u2'), null);

	// A minute left: renewed with the refresh token.
	assert.deepEqual(await notion.renewNotionTokens(), ['u1']);
	assert.equal(notion.notionAccessToken('u1'), 'at-2');
	assert.equal(store.getNotionSecret('u1')?.refreshToken, 'rt-2');
	assert.deepEqual(await notion.renewNotionTokens(), [], 'an hour left: nothing to do');

	// Sessions you start get it as notion, in a token file only the session's user can read.
	ensureDirs('sessions/s1/.orb', 'sessions/s2/.orb');
	writeSessionMcp('s1', 'acct', 'u1');
	writeSessionMcp('s2', 'acct', 'u2');
	const mcp = (id: string) => JSON.parse(readFileSync(join(metaDir(id), 'mcp.json'), 'utf8')).mcpServers;
	assert.deepEqual(mcp('s1').notion, { type: 'stdio', command: 'node', args: ['/session/.orb/orb-notion.mjs'] });
	assert.equal(mcp('s2').notion, undefined, 'not other people\'s sessions');
	assert.equal(readFileSync(join(metaDir('s1'), 'notion-token'), 'utf8'), 'at-2\n');
	assert.equal(statSync(join(metaDir('s1'), 'notion-token')).mode & 0o777, 0o600);

	await notion.disconnectNotion('u1');
	assert.equal(notion.notionAccessToken('u1'), null);
	assert.equal(new URLSearchParams(nb.calls.at(-1)!.body).get('token'), 'rt-2', 'asked Notion to revoke it');
	nb.restore();
});

test("the session's relay forwards to Notion with the current token, and picks up a renewed one", async () => {
	const seen: { auth: string | undefined; session: string | undefined; method: string }[] = [];
	let valid = 'tok-A';
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', (d) => (body += d));
		req.on('end', () => {
			const m = JSON.parse(body);
			seen.push({ auth: req.headers.authorization, session: req.headers['mcp-session-id'] as string | undefined, method: m.method });
			if (req.headers.authorization !== `Bearer ${valid}`) return res.writeHead(401).end();
			if (m.id === undefined) return res.writeHead(202).end();
			if (m.method === 'initialize') {
				res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' });
				return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'notion' } } })}\n\n`);
			}
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'notion-search' }] } }));
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const port = (server.address() as { port: number }).port;
	const dir = mkdtempSync(join(tmpdir(), 'orb-bridge-'));
	const tokenFile = join(dir, 'notion-token');
	writeFileSync(tokenFile, 'tok-A\n');
	const script = join(dir, 'orb-notion.mjs');
	writeFileSync(script, NOTION_BRIDGE_SCRIPT.replace('https://mcp.notion.com/mcp', `http://127.0.0.1:${port}/mcp`).replace('/session/.orb/notion-token', tokenFile));

	const child = spawn('node', [script], { stdio: ['pipe', 'pipe', 'inherit'] });
	const answers: Record<number, unknown>[] = [];
	let buf = '';
	child.stdout.on('data', (d) => {
		buf += d;
		for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) if (buf.slice(0, i).trim()) answers.push(JSON.parse(buf.slice(0, i)));
	});
	const ask = (m: object) => child.stdin.write(JSON.stringify(m) + '\n');
	const answer = async (id: number) => {
		for (let t = 0; t < 100; t++) {
			const a = answers.find((x) => (x as { id?: number }).id === id);
			if (a) return a as { result?: { tools?: { name: string }[]; serverInfo?: object } };
			await new Promise((r) => setTimeout(r, 50));
		}
		throw new Error(`no answer to ${id}`);
	};
	ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude' } } });
	assert.deepEqual((await answer(1)).result!.serverInfo, { name: 'notion' });
	ask({ jsonrpc: '2.0', method: 'notifications/initialized' });
	// Orbital renews the token and rewrites the file; Notion stops accepting the old one.
	writeFileSync(tokenFile, 'tok-B\n');
	valid = 'tok-B';
	ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
	assert.deepEqual((await answer(2)).result!.tools, [{ name: 'notion-search' }]);
	child.kill();
	server.close();
	assert.equal(seen[0].auth, 'Bearer tok-A');
	assert.equal(seen.at(-1)!.auth, 'Bearer tok-B');
	assert.equal(seen.at(-1)!.session, 'sess-1', "keeps Notion's session id");
});
