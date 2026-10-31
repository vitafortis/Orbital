import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The store opens its database on first use, under ORB_DATA_DIR.
process.env.ORB_DATA_DIR = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_SECRET_KEY = 'test-key';
const store = await import('#lib/server/store.ts');
const { parseSessionInput } = await import('#lib/server/sessions/input.ts');
const { repoLabel } = await import('#lib/launch.ts');

const account = store.createAccount({ name: 'Work', kind: 'api_key', config: {}, secrets: { apiKey: 'sk-test' } });

test('a session without a repo starts in a folder named after it', () => {
	const s = parseSessionInput({ accountId: account.id, repo: '', name: 'Invoice parser' });
	assert.equal(s.repoUrl, '');
	assert.equal(s.repoFullName, null);
	assert.equal(s.repoDir, 'invoice-parser');
	assert.equal(repoLabel(s), 'No repo');
	assert.equal(repoLabel(parseSessionInput({ accountId: account.id, repo: 'acme/site' })), 'acme/site');
});

test('without a repo, the session needs a name and has no branch or pull request', () => {
	assert.throws(() => parseSessionInput({ accountId: account.id }), /Name the session/);
	assert.throws(() => parseSessionInput({ accountId: account.id, name: 'x', baseBranch: 'main' }), /no branch/);
	assert.throws(() => parseSessionInput({ accountId: account.id, name: 'x', checkoutPr: 3 }), /Pull requests/);
	assert.throws(() => parseSessionInput({ accountId: account.id, repo: 'not a repo' }), /owner\/name/);
});

test('images saved in Settings before the rename move to the Orbital ones', () => {
	store.saveSettings({ ...store.getSettings(), sessionImage: 'ghcr.io/vitafortis/cc-modern-session:latest', agentsImage: 'ghcr.io/vitafortis/cc-modern-session:latest-all' });
	assert.equal(store.getSettings().sessionImage, 'ghcr.io/vitafortis/orbital-session:latest');
	assert.equal(store.getSettings().agentsImage, 'ghcr.io/vitafortis/orbital-session:latest-all');
	store.saveSettings({ ...store.getSettings(), sessionImage: 'registry.lan/cc-modern-session:mine' });
	assert.equal(store.getSettings().sessionImage, 'registry.lan/cc-modern-session:mine');
});
