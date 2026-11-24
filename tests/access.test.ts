import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ORB_DATA_DIR = mkdtempSync(join(tmpdir(), 'orb-test-'));
process.env.ORB_SECRET_KEY = 'test-key';
const { apiDenied, canControl } = await import('#lib/access.ts');
const accessForRules = await import('#lib/server/auth-config.ts');
const { accessFor, defaultAuthSettings } = accessForRules;
const store = await import('#lib/server/store.ts');

const admin = { id: 'a', role: 'admin' as const };
const member = { id: 'm', role: 'member' as const };
const viewer = { id: 'v', role: 'viewer' as const };
const owners: Record<string, string | null> = { mine: 'm', theirs: 'x', automation: null };
const deny = (who: { id: string; role: 'admin' | 'member' | 'viewer' }, method: string, path: string) => apiDenied(who, method, path, (id) => (id in owners ? owners[id] : undefined));

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

test('a role set by hand stays through sign-ins, until the admin goes back to the rules', () => {
	const { whyRole } = accessForRules;
	const access = { ...defaultAuthSettings().access, adminGroups: ['appsec'], memberEmails: ['@eng.ironclad.com'], defaultRole: 'viewer' as const };
	assert.equal(whyRole(access, 'x@ironclad.com', ['appsec']), 'admin rule: group appsec');
	assert.equal(whyRole(access, 'x@eng.ironclad.com', []), 'member rule: @eng.ironclad.com');
	assert.equal(whyRole(access, 'x@ironclad.com', []), 'the default role');

	const u = store.upsertExternalUser({ email: 'pm@ironclad.com', name: 'P', source: 'oidc', role: 'viewer', rule: 'the default role' });
	assert.equal(u.roleRule, 'viewer, by the default role');
	store.setUserRole(u.id, 'member');
	const again = store.upsertExternalUser({ email: 'pm@ironclad.com', name: 'P', source: 'oidc', role: 'viewer', rule: 'the default role' });
	assert.equal(again.role, 'member', 'set by hand: the sign-in left it');
	assert.equal(again.rolePinned, true);
	store.unpinUserRole(u.id);
	assert.equal(store.getUser(u.id)!.role, 'viewer', 'back to what the rules said');
});

test('a role for a while: higher only, and it ends on its own', () => {
	const u = store.upsertExternalUser({ email: 'temp@ironclad.com', name: null, source: 'oidc', role: 'member' });
	store.requestAccess(u.id, 'admin', 'Rotating the GitHub App key');
	assert.equal(store.listAccessRequests()[0]?.note, 'Rotating the GitHub App key');
	store.setTempRole(u.id, 'admin', new Date(Date.now() + 3600_000).toISOString());
	const now = store.getUser(u.id)!;
	assert.deepEqual([now.role, now.baseRole, now.tempRole], ['admin', 'member', 'admin']);
	assert.equal(store.listAccessRequests().length, 0, 'approved: the request is settled');
	store.setTempRole(u.id, 'admin', new Date(Date.now() - 1000).toISOString());
	assert.deepEqual([store.getUser(u.id)!.role, store.getUser(u.id)!.tempRole], ['member', null], 'its time is up');
	store.setTempRole(u.id, 'viewer', new Date(Date.now() + 3600_000).toISOString());
	assert.equal(store.getUser(u.id)!.role, 'member', 'never lower than their own role');
	assert.equal(deny({ id: u.id, role: 'viewer' }, 'POST', '/api/access-request'), null, 'anyone may ask');
});
