import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_DATA_DIR = dataDir;
process.env.ORB_SESSIONS_DIR = join(dataDir, 'sessions');
process.env.ORB_SECRET_KEY = 'test-key';
const { addTodo, openTodos, readTodos, setTodoDone } = await import('#lib/server/sessions/todos.ts');
const { ensureDirs, metaDir } = await import('#lib/server/sessions/storage.ts');
const { ORB_MCP_SCRIPT } = await import('#lib/server/sessions/orb-mcp.ts');

ensureDirs('sessions/s1/.orb');
const dir = metaDir('s1');

/** Runs Orbital's MCP tool as Claude would, against this session's folder; its answers by id. */
function mcp(...messages: object[]): Record<number, { result?: { content?: { text: string }[]; tools?: { name: string }[] } }> {
	const script = join(dir, 'orb-mcp.mjs');
	writeFileSync(script, ORB_MCP_SCRIPT.replaceAll('/session/.orb', dir));
	const out = execFileSync('node', [script], { input: messages.map((m) => JSON.stringify(m)).join('\n') + '\n' }).toString();
	return Object.fromEntries(out.trim().split('\n').map((l) => [JSON.parse(l).id, JSON.parse(l)]));
}

test('the agent adds to the To do list through its tool, and sees what you marked done', () => {
	const r = mcp(
		{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
		{ jsonrpc: '2.0', method: 'notifications/initialized' },
		{ jsonrpc: '2.0', id: 2, method: 'tools/list' },
		{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_todo_for_user', arguments: { title: 'Log in to AWS SSO', command: 'aws sso login --profile staging', where: 'your-machine', why: 'To read the staging logs.' } } },
		{ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'add_todo_for_user', arguments: { title: '' } } }
	);
	assert.deepEqual(r[2].result!.tools!.map((t) => t.name), ['add_todo_for_user', 'list_todos_for_user']);
	assert.match(r[3].result!.content![0].text, /Added/);
	assert.match(r[4].result!.content![0].text, /title is required/);

	// A line it can't read (written halfway, or by a newer Orbital) is skipped.
	appendFileSync(join(dir, 'todos.jsonl'), '{"half\n');
	const mine = addTodo('s1', { title: 'Approve the deploy', command: null, where: 'browser', why: null });
	const [aws] = readTodos('s1');
	assert.deepEqual(
		{ ...aws, id: '', at: '' },
		{ id: '', sessionId: 's1', title: 'Log in to AWS SSO', command: 'aws sso login --profile staging', where: 'your-machine', why: 'To read the staging logs.', source: 'agent', at: '', doneAt: null }
	);
	assert.equal(openTodos('s1').length, 2);

	setTodoDone('s1', aws.id, true);
	assert.deepEqual(openTodos('s1').map((t) => t.id), [mine.id]);
	const list = mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_todos_for_user', arguments: {} } });
	assert.equal(list[5].result!.content![0].text, '[done] Log in to AWS SSO (aws sso login --profile staging)\n[open] Approve the deploy');
	assert.equal(setTodoDone('s1', 'nope', true), undefined);
});
