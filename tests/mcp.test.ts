import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_DATA_DIR = dataDir;
process.env.ORB_SESSIONS_DIR = join(dataDir, 'sessions');
process.env.ORB_SECRET_KEY = 'test-key';
const store = await import('#lib/server/store.ts');
const { writeSessionMcp } = await import('#lib/server/sessions/mcp.ts');
const { ensureDirs, metaDir } = await import('#lib/server/sessions/storage.ts');
const { NOTION_PACKAGE } = await import('#lib/mcp.ts');

const base = { command: null, args: [], url: null, notion: null, accountIds: [] as string[], enabled: true };

test('Library servers become the session\'s --mcp-config, secrets included, for the accounts they\'re for', () => {
	const notion = store.createMcpServer({ ...base, name: 'notion', kind: 'notion', notion: { bot: 'Orbital', workspace: 'Armistice' } }, { token: 'ntn_secret' });
	store.createMcpServer({ ...base, name: 'sentry', kind: 'http', url: 'https://mcp.sentry.dev/mcp', accountIds: ['acct-b'] }, { headers: { Authorization: 'Bearer s' } });
	store.createMcpServer({ ...base, name: 'local', kind: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], enabled: false }, {});

	// The browser never sees a secret's value.
	assert.deepEqual(store.getMcpServer(notion.id)?.secretKeys, ['token']);
	assert.doesNotMatch(JSON.stringify(store.listMcpServers()), /ntn_secret|Bearer s/);

	ensureDirs('sessions/s1/.orb');
	assert.equal(writeSessionMcp('s1', 'acct-a'), '/session/.orb/mcp.json');
	const file = join(metaDir('s1'), 'mcp.json');
	assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
		mcpServers: { notion: { type: 'stdio', command: 'npx', args: ['-y', NOTION_PACKAGE], env: { NOTION_TOKEN: 'ntn_secret' } } }
	});

	writeSessionMcp('s1', 'acct-b');
	assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).mcpServers), ['notion', 'sentry']);

	// Nothing for the account: no file, no flag.
	store.updateMcpServer(notion.id, { ...base, name: 'notion', kind: 'notion', notion: null, accountIds: ['acct-b'] });
	assert.equal(writeSessionMcp('s1', 'acct-a'), null);
	assert.equal(existsSync(file), false);
	// Updating without secrets keeps them.
	assert.deepEqual(store.getMcpSecrets(notion.id), { token: 'ntn_secret' });
});
