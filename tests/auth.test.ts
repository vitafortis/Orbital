import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipMatches, isRange } from '#lib/server/net.ts';

test('ipMatches: IPv4, IPv6, mapped addresses and CIDRs', () => {
	assert.ok(ipMatches('172.18.0.5', ['172.16.0.0/12']));
	assert.ok(ipMatches('::ffff:172.18.0.5', ['172.16.0.0/12']), 'IPv4 on a dual-stack socket');
	assert.ok(!ipMatches('172.32.0.1', ['172.16.0.0/12']));
	assert.ok(ipMatches('192.168.1.10', ['192.168.1.10']));
	assert.ok(!ipMatches('192.168.1.11', ['192.168.1.10']));
	assert.ok(ipMatches('::1', ['::1/128']));
	assert.ok(ipMatches('fd12:3456::1', ['fc00::/7']));
	assert.ok(!ipMatches('2001:db8::1', ['fc00::/7']));
	assert.ok(ipMatches('2001:db8::abcd', ['2001:db8::/32']));
	assert.ok(!ipMatches('10.0.0.1', ['::/0']), 'families never mix');
	assert.ok(ipMatches('8.8.8.8', ['0.0.0.0/0']));
	assert.ok(!ipMatches('not-an-ip', ['0.0.0.0/0']));
	assert.ok(isRange('10.0.0.0/8') && isRange('fe80::1') && !isRange('10.0.0.0/33') && !isRange('example.com'));
});

test('emailMatches and accessFor', async () => {
	const { accessFor, emailMatches } = await import('#lib/server/auth-config.ts');
	assert.ok(emailMatches(['@example.com'], 'Sam@Example.com'));
	assert.ok(emailMatches(['*@example.com'], 'sam@example.com'));
	assert.ok(!emailMatches(['@example.com'], 'sam@notexample.com.evil'));
	assert.ok(emailMatches(['*'], 'anyone@x.io'));
	const none = { allowedEmails: [], allowedGroups: [], adminEmails: [], adminGroups: [] };
	assert.deepEqual(accessFor(none, 'a@b.c', []), { allowed: true, role: 'member' });
	const rules = { allowedEmails: ['@home.arpa'], allowedGroups: ['devs'], adminEmails: ['me@x.io'], adminGroups: ['admins'] };
	assert.deepEqual(accessFor(rules, 'kid@home.arpa', []), { allowed: true, role: 'member' });
	assert.deepEqual(accessFor(rules, 'guest@x.io', ['devs']), { allowed: true, role: 'member' });
	assert.deepEqual(accessFor(rules, 'guest@x.io', ['family']), { allowed: false, role: 'member' });
	assert.deepEqual(accessFor(rules, 'boss@x.io', ['Admins']), { allowed: true, role: 'admin' });
	assert.deepEqual(accessFor(rules, 'me@x.io', []), { allowed: true, role: 'admin' });
});

test('parseAuthSettings refuses settings that lock everyone out', async () => {
	const { parseAuthSettings } = await import('#lib/server/auth-input.ts');
	assert.throws(() => parseAuthSettings({ required: true, passwordForm: false }), /password form/);
	assert.throws(() => parseAuthSettings({ oidc: { enabled: true, issuer: 'https://id.x' } }), /client ID/);
	assert.throws(() => parseAuthSettings({ oidc: { enabled: true, issuer: 'https://id.x', clientId: 'c', scopes: 'email' } }), /openid/);
	assert.throws(() => parseAuthSettings({ proxy: { enabled: true, trustedProxies: [] } }), /proxy/);
	assert.throws(() => parseAuthSettings({ proxy: { enabled: true, trustedProxies: ['proxy.lan'] } }), /CIDR/);
	const s = parseAuthSettings({ passwordForm: false, oidc: { enabled: true, issuer: 'https://id.x/', clientId: 'c' }, access: { adminEmails: 'me@x.io\n\n' } });
	assert.equal(s.oidc.issuer, 'https://id.x');
	assert.equal(s.oidc.scopes, 'openid email profile');
	assert.deepEqual(s.access.adminEmails, ['me@x.io']);
	assert.equal(parseAuthSettings({ required: false, passwordForm: false }).required, false, 'sign-in off needs no form');
});
