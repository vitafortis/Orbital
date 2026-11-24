/**
 * Sign-in settings, kept in the database and edited under Settings → Sign-in. ORB_AUTH=disabled
 * still turns sign-in off from the environment, for recovery.
 */
import { config } from './config.ts';
import { decrypt, encrypt } from './crypto.ts';
import { getKv, setKv } from './store.ts';
import type { AuthSettings, UserRole } from '#lib/types.ts';

// Docker's and the usual LAN ranges: a proxy in the same compose project or on the LAN.
export const PRIVATE_RANGES = ['127.0.0.1/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'];

export function defaultAuthSettings(): AuthSettings {
	return {
		required: true,
		passwordForm: true,
		oidc: { enabled: false, issuer: '', clientId: '', hasSecret: false, scopes: 'openid email profile', label: 'SSO', groupsClaim: 'groups' },
		proxy: { enabled: false, emailHeader: 'Remote-Email', nameHeader: 'Remote-Name', groupsHeader: 'Remote-Groups', trustedProxies: PRIVATE_RANGES, logoutUrl: '' },
		access: { allowedEmails: [], allowedGroups: [], adminEmails: [], adminGroups: [], memberEmails: [], memberGroups: [], defaultRole: 'member' }
	};
}

export function getAuthSettings(): AuthSettings {
	const d = defaultAuthSettings();
	const s = getKv<Partial<AuthSettings>>('auth', {});
	return {
		required: s.required ?? d.required,
		passwordForm: s.passwordForm ?? d.passwordForm,
		oidc: { ...d.oidc, ...s.oidc, hasSecret: !!getKv<string | null>('auth:oidc-secret', null) },
		proxy: { ...d.proxy, ...s.proxy },
		access: { ...d.access, ...s.access }
	};
}

/** Saves the settings; a client secret replaces the stored one, null removes it, undefined keeps it. */
export function saveAuthSettings(s: AuthSettings, clientSecret?: string | null) {
	setKv('auth', { ...s, oidc: { ...s.oidc, hasSecret: undefined } });
	if (clientSecret !== undefined) setKv('auth:oidc-secret', clientSecret ? encrypt(clientSecret, 'auth:oidc') : null);
}

export function oidcClientSecret(): string | undefined {
	const v = getKv<string | null>('auth:oidc-secret', null);
	return v ? decrypt(v, 'auth:oidc') : undefined;
}

export const signInRequired = () => !config.authDisabled && getAuthSettings().required;

/** "a@b.com", "@b.com" or "*@b.com" (anyone at b.com), or "*" (anyone). */
export function emailMatches(patterns: string[], email: string): boolean {
	const e = email.trim().toLowerCase();
	return patterns.some((raw) => {
		const p = raw.trim().toLowerCase();
		if (!p) return false;
		if (p === '*') return true;
		if (p.startsWith('*@')) return e.endsWith(p.slice(1));
		if (p.startsWith('@')) return e.endsWith(p);
		return e === p;
	});
}

const groupsMatch = (patterns: string[], groups: string[]) => {
	const want = new Set(patterns.map((g) => g.trim().toLowerCase()).filter(Boolean));
	return groups.some((g) => want.has(g.trim().toLowerCase()));
};

/** Which rule gives an SSO identity its role, in words for the users list. */
export function whyRole(a: AuthSettings['access'], email: string, groups: string[]): string {
	const byEmail = (patterns: string[]) => patterns.map((p) => p.trim()).find((p) => p && emailMatches([p], email));
	const byGroup = (patterns: string[]) => {
		const want = new Set(patterns.map((g) => g.trim().toLowerCase()).filter(Boolean));
		return groups.find((g) => want.has(g.trim().toLowerCase()));
	};
	for (const [role, emails, gs] of [
		['admin', a.adminEmails, a.adminGroups],
		['member', a.memberEmails ?? [], a.memberGroups ?? []]
	] as const) {
		const e = byEmail(emails);
		if (e) return `${role} rule: ${e}`;
		const g = byGroup(gs);
		if (g) return `${role} rule: group ${g}`;
	}
	return 'the default role';
}

/**
 * Whether an SSO identity may sign in, and with which role: admin, then member, by the rules;
 * anyone else allowed in gets the default role. No allow list: anyone the provider lets through.
 */
export function accessFor(a: AuthSettings['access'], email: string, groups: string[]): { allowed: boolean; role: UserRole } {
	const admin = emailMatches(a.adminEmails, email) || groupsMatch(a.adminGroups, groups);
	// Settings saved before member rules existed have none.
	const member = emailMatches(a.memberEmails ?? [], email) || groupsMatch(a.memberGroups ?? [], groups);
	const open = !a.allowedEmails.some((x) => x.trim()) && !a.allowedGroups.some((x) => x.trim());
	return {
		allowed: admin || member || open || emailMatches(a.allowedEmails, email) || groupsMatch(a.allowedGroups, groups),
		role: admin ? 'admin' : member ? 'member' : a.defaultRole === 'viewer' ? 'viewer' : 'member'
	};
}
