import { defaultAuthSettings } from './auth-config.ts';
import { BadRequest } from './http.ts';
import { isRange } from './net.ts';
import type { AuthSettings } from '#lib/types.ts';

const HEADER = /^[A-Za-z0-9-]{1,80}$/;

const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown) =>
	(Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : [])
		.filter((x): x is string => typeof x === 'string')
		.map((x) => x.trim())
		.filter(Boolean)
		.slice(0, 200);

function httpUrl(v: string, what: string): string {
	if (!v) return '';
	let u: URL;
	try {
		u = new URL(v);
	} catch {
		throw new BadRequest(`${what} must be a URL`);
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new BadRequest(`${what} must start with https://`);
	return v.replace(/\/+$/, '');
}

/** Sign-in settings from a request, checked so a save can't lock everyone out. */
export function parseAuthSettings(b: Record<string, unknown>): AuthSettings {
	const d = defaultAuthSettings();
	const o = (b.oidc ?? {}) as Record<string, unknown>;
	const p = (b.proxy ?? {}) as Record<string, unknown>;
	const a = (b.access ?? {}) as Record<string, unknown>;
	const s: AuthSettings = {
		required: b.required !== false,
		passwordForm: b.passwordForm !== false,
		oidc: {
			enabled: o.enabled === true,
			issuer: httpUrl(text(o.issuer), 'The issuer'),
			clientId: text(o.clientId, 300),
			hasSecret: false,
			scopes: text(o.scopes) || d.oidc.scopes,
			label: text(o.label, 40) || d.oidc.label,
			groupsClaim: text(o.groupsClaim, 100) || d.oidc.groupsClaim
		},
		proxy: {
			enabled: p.enabled === true,
			emailHeader: text(p.emailHeader, 80) || d.proxy.emailHeader,
			// Left out: the defaults. Sent empty: none (no name or groups header).
			nameHeader: 'nameHeader' in p ? text(p.nameHeader, 80) : d.proxy.nameHeader,
			groupsHeader: 'groupsHeader' in p ? text(p.groupsHeader, 80) : d.proxy.groupsHeader,
			trustedProxies: 'trustedProxies' in p ? list(p.trustedProxies) : d.proxy.trustedProxies,
			logoutUrl: httpUrl(text(p.logoutUrl), 'The logout URL')
		},
		access: {
			allowedEmails: list(a.allowedEmails),
			allowedGroups: list(a.allowedGroups),
			adminEmails: list(a.adminEmails),
			adminGroups: list(a.adminGroups),
			memberEmails: list(a.memberEmails),
			memberGroups: list(a.memberGroups),
			defaultRole: a.defaultRole === 'viewer' ? 'viewer' : 'member',
			othersSessions: a.othersSessions === 'watch' || a.othersSessions === 'hidden' ? a.othersSessions : 'names'
		}
	};
	if (s.oidc.enabled) {
		if (!s.oidc.issuer) throw new BadRequest('Enter the provider’s issuer URL');
		if (!s.oidc.clientId) throw new BadRequest('Enter the client ID from the provider');
		if (!s.oidc.scopes.split(/\s+/).includes('openid')) throw new BadRequest('The scopes must include openid');
	}
	for (const h of [s.proxy.emailHeader, s.proxy.nameHeader, s.proxy.groupsHeader]) if (h && !HEADER.test(h)) throw new BadRequest(`"${h}" isn't a header name`);
	if (s.proxy.enabled && !s.proxy.trustedProxies.length) throw new BadRequest('List the reverse proxy’s address, so other clients can’t send the headers');
	for (const r of s.proxy.trustedProxies) if (!isRange(r)) throw new BadRequest(`"${r}" isn't an address or CIDR range`);
	if (s.required && !s.passwordForm && !s.oidc.enabled && !s.proxy.enabled) throw new BadRequest('Keep the password form on until single sign-on is set up');
	return s;
}
