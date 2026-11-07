import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs, isValidBranch, parseRepo, slugify } from '#lib/launch.ts';

test('parseRepo accepts owner/name and GitHub URLs', () => {
	for (const input of ['vitafortis/pg-modern', 'https://github.com/vitafortis/pg-modern', 'https://github.com/vitafortis/pg-modern.git', 'git@github.com:vitafortis/pg-modern.git', 'github.com/vitafortis/pg-modern/']) {
		assert.deepEqual(parseRepo(input), { url: 'https://github.com/vitafortis/pg-modern.git', fullName: 'vitafortis/pg-modern', dir: 'pg-modern' }, input);
	}
});

test('parseRepo accepts other https git hosts, rejects credentials and junk', () => {
	assert.deepEqual(parseRepo('https://gitea.lan/me/notes.git'), { url: 'https://gitea.lan/me/notes.git', fullName: null, dir: 'notes' });
	assert.equal(parseRepo('https://user:pass@gitea.lan/me/notes.git'), null);
	assert.equal(parseRepo('ftp://example.com/x'), null);
	assert.equal(parseRepo('not a repo'), null);
	assert.equal(parseRepo(''), null);
});

test('slugify and branch names', () => {
	assert.equal(slugify('Fix: the Login page!'), 'fix-the-login-page');
	assert.equal(slugify('***'), 'session');
	assert.ok(isValidBranch('claude/fix-login'));
	for (const bad of ['-x', 'a..b', 'a b', 'x.lock', 'a~1', 'feat/', 'a\\b']) assert.ok(!isValidBranch(bad), bad);
});

test('claudeArgs: a new session with a first message', () => {
	assert.deepEqual(
		claudeArgs({ name: 'api', model: 'opus', permissionMode: 'acceptEdits', remoteControl: true }, { mode: 'new', prompt: 'fix the tests' }),
		['--name', 'api', '--model', 'opus', '--permission-mode', 'acceptEdits', '--remote-control', 'api', 'fix the tests']
	);
});

test('claudeArgs: the Library\'s MCP servers come first', () => {
	assert.deepEqual(
		claudeArgs({ name: 'api', model: null, permissionMode: 'default', remoteControl: false, mcpConfig: '/session/.orb/mcp.json' }, { mode: 'new', prompt: 'hi' }),
		['--mcp-config', '/session/.orb/mcp.json', '--name', 'api', 'hi']
	);
});

test('claudeArgs: continue and resume, without Remote Control', () => {
	const opts = { name: 'api', model: null, permissionMode: 'default' as const, remoteControl: false };
	assert.deepEqual(claudeArgs(opts, { mode: 'continue' }), ['--name', 'api', '--continue']);
	const id = '550e8400-e29b-41d4-a716-446655440000';
	assert.deepEqual(claudeArgs(opts, { mode: 'resume', conversationId: id }), ['--name', 'api', '--resume', id]);
	assert.throws(() => claudeArgs(opts, { mode: 'resume', conversationId: '--dangerously-skip-permissions' }));
});

test('claudeArgs: a prompt that looks like a flag stays a prompt', () => {
	const args = claudeArgs({ name: 'x', model: null, permissionMode: 'default', remoteControl: false }, { mode: 'new', prompt: '--help me' });
	assert.equal(args.at(-1), ' --help me');
});
