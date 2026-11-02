import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_DATA_DIR = dataDir;
process.env.ORB_SESSIONS_DIR = join(dataDir, 'sessions');
const { attachmentName, saveAttachment } = await import('#lib/server/sessions/attachments.ts');

const at = new Date('2026-11-02T10:11:12.345Z');

test('attachment names keep the original, made safe and unique by time', () => {
	assert.equal(attachmentName('image.png', at), '2026-11-02T10-11-12-345Z-image.png');
	assert.equal(attachmentName('Screen Shot 2026-11-02 at 10.11.png', at), '2026-11-02T10-11-12-345Z-Screen-Shot-2026-11-02-at-10.11.png');
	assert.equal(attachmentName('../../etc/passwd', at), '2026-11-02T10-11-12-345Z-passwd');
	assert.equal(attachmentName('C:\\Users\\me\\log.txt', at), '2026-11-02T10-11-12-345Z-log.txt');
	assert.equal(attachmentName('..', at), '2026-11-02T10-11-12-345Z-file');
	assert.equal(attachmentName('', at), '2026-11-02T10-11-12-345Z-file');
});

test('saveAttachment writes under the session folder and answers with the container path', () => {
	const path = saveAttachment('s1', 'shot.png', new Uint8Array([1, 2, 3]));
	assert.match(path, /^\/session\/\.orb\/attachments\/[\w-]+-shot\.png$/);
	const onDisk = join(dataDir, 'sessions', 'sessions', 's1', path.slice('/session/'.length));
	assert.deepEqual([...readFileSync(onDisk)], [1, 2, 3]);
});
