import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ORB_DATA_DIR = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_SECRET_KEY = 'test-key';
const { apiDenied, canControl } = await import('#lib/access.ts');
const { accessFor, defaultAuthSettings } = await import('#lib/server/auth-config.ts');
const store = await import('#lib/server/store.ts');

const admin = { id: 'a', role: 'admin' as const };
const member = { id: 'm', role: 'member' as const };
const viewer = { id: 'v', role: 'viewer' as const };
const owners: Record<string, string | null> = { mine: 'm', theirs: 'x', automation: null };
const deny = (who: typeof admin | typeof member | typeof viewer, method: string, path: string) => apiDenied(who, method, path, (id) => (id in owners ? owners[id] : undefined));

test('sessions: admins control all, members their own, viewers none', () => {
	assert.equal(canControl(admin, { ownerId: 'x' }), true);
	assert.equal(canControl(member, { ownerId: 'm' }), true);
	assert.equal(canControl(member, { ownerId: 'x' }), false);
	assert.equal(canControl(member, { ownerId: null }), false, 'automations and older sessions: admins only');
	assert.equal(canControl(viewer, { ownerId: 'v' }), false);
	assert.equal(canControl(null, { ownerId: 'm' }), false);
});

test('the API: reads for everyone signed in; changes by role', () => {
	for (const who of [admin, member, viewer]) assert.equal(deny(who, 'GET', '/api/sessions/theirs/conversations'), null);
	// Viewers: nothing but their own account.
	assert.match(deny(viewer, 'POST', '/api/sessions')!, /view-only/);
	assert.match(deny(viewer, 'POST', '/api/sessions/mine/stop')!, /view-only/);
	assert.equal(deny(viewer, 'PUT', '/api/account'), null);
	assert.equal(deny(viewer, 'POST', '/api/auth/logout'), null);
	// Members: start sessions, change their own, not others' or the shared settings.
	assert.equal(deny(member, 'POST', '/api/sessions'), null);
	for (const p of ['/api/sessions/mine/stop', '/api/sessions/mine/send', '/api/sessions/mine/attachments', '/api/sessions/mine/todos/t1']) assert.equal(deny(member, 'POST', p), null, p);
	for (const p of ['/api/sessions/theirs/send', '/api/sessions/automation/stop']) assert.match(deny(member, 'POST', p)!, /isn't your session/, p);
	assert.match(deny(member, 'DELETE', '/api/sessions/theirs')!, /isn't your session/);
	assert.equal(deny(member, 'POST', '/api/sessions/nope/stop'), null, 'no such session: the endpoint says so');
	for (const p of ['/api/github-accounts', '/api/model-accounts', '/api/profiles', '/api/linear/rules', '/api/library/skills', '/api/settings', '/api/github/device']) assert.match(deny(member, 'POST', p)!, /Only an admin/, p);
	assert.equal(deny(member, 'POST', '/api/notion/connect'), null, 'their own Notion');
	assert.equal(deny(member, 'POST', '/api/github/repos'), null, 'a new repo for a session');
	// Admins: everything.
	for (const p of ['/api/sessions/theirs/send', '/api/settings', '/api/users/u1']) assert.equal(deny(admin, 'PATCH', p), null, p);
});

test('SSO rules give each person a role, and it follows the rules at every sign-in', () => {
	const access = { ...defaultAuthSettings().access, adminGroups: ['appsec'], memberGroups: ['eng'], defaultRole: 'viewer' as const };
	assert.deepEqual(accessFor(access, 'a@ironclad.com', ['appsec', 'eng']), { allowed: true, role: 'admin' });
	assert.deepEqual(accessFor(access, 'e@ironclad.com', ['eng']), { allowed: true, role: 'member' });
	assert.deepEqual(accessFor(access, 'p@ironclad.com', ['sales']), { allowed: true, role: 'viewer' });
	assert.deepEqual(accessFor({ ...access, allowedGroups: ['eng'] }, 'p@ironclad.com', ['sales']), { allowed: false, role: 'viewer' });
	// Before this setting existed: everyone allowed in was a member.
	assert.equal(accessFor(defaultAuthSettings().access, 'x@y.z', []).role, 'member');

	const u = store.upsertExternalUser({ email: 'e@ironclad.com', name: 'E', source: 'oidc', role: 'member' });
	assert.equal(u.role, 'member');
	assert.equal(store.upsertExternalUser({ email: 'e@ironclad.com', name: 'E', source: 'oidc', role: 'viewer' }).role, 'viewer', 'out of the group: down to viewer');
	assert.equal(store.upsertExternalUser({ email: 'e@ironclad.com', name: 'E', source: 'oidc', role: 'admin' }).role, 'admin');
});
