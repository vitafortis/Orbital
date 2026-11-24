/**
 * The organization's accounts and connections, and people's own, as each person sees them.
 * The organization's are admins' to manage: others see only enough to pick one for a session
 * (name and kind, not settings, emails or scopes). A person's own are theirs alone; admins see
 * that they exist, and whose, so they can remove them.
 */
import { usableBy, type Who } from '#lib/access.ts';
import type { GithubAccount, ModelAccount } from '#lib/types.ts';
import { BadRequest } from './http.ts';
import { getAccount, getGithubAccount, getUser, listAccounts, listGithubAccounts } from './store.ts';

const brief = (a: ModelAccount): ModelAccount => ({ ...a, config: {}, secrets: [], email: null, plan: null });
const briefGithub = (a: GithubAccount): GithubAccount => ({ ...a, scopes: null, permissions: null, renewError: null });

/** The model accounts `who` can pick for their sessions: the organization's, then their own. */
export function accountsFor(who: Who): ModelAccount[] {
	return listAccounts()
		.filter((a) => usableBy(who?.id, a))
		.map((a) => (a.ownerId || who?.role === 'admin' ? a : brief(a)));
}

/** The GitHub connections `who` can pick for their sessions, and look up repos with. */
export function githubAccountsFor(who: Who): GithubAccount[] {
	return listGithubAccounts()
		.filter((a) => usableBy(who?.id, a))
		.map((a) => (a.ownerId || who?.role === 'admin' ? a : briefGithub(a)));
}

/** For a session started by `ownerId` (null: an automation): the account, if it may use it. */
export function accountForSession(id: string, ownerId: string | null): ModelAccount {
	const a = getAccount(id);
	if (!a) throw new BadRequest('Pick a model account');
	if (!usableBy(ownerId, a)) throw new BadRequest("That's someone else's own account: pick one of the organization's, or your own");
	return a;
}

export function githubAccountForSession(id: string | null, ownerId: string | null): GithubAccount | null {
	if (!id) return null;
	const a = getGithubAccount(id);
	if (!a) throw new BadRequest('That GitHub account no longer exists');
	if (!usableBy(ownerId, a)) throw new BadRequest("That's someone else's own GitHub connection: pick one of the organization's, or your own");
	return a;
}

/** The organization's only: for profiles and automations, which run as nobody in particular. */
export function requireOrgAccount(a: { ownerId: string | null } | undefined, what = 'account') {
	if (a?.ownerId) throw new BadRequest(`That ${what} is one person's own: profiles and automations use the organization's`);
}

export type OthersOwn = { id: string; what: 'model' | 'github'; name: string; kind: string; owner: string; createdAt: string };

/** Admins: everyone else's own accounts and connections, with whose they are (no details). */
export function othersOwn(who: Who): OthersOwn[] {
	if (who?.role !== 'admin') return [];
	const ownerName = (id: string) => {
		const u = getUser(id);
		return u ? (u.name ?? u.email) : 'a removed user';
	};
	return [
		...listAccounts()
			.filter((a) => a.ownerId && a.ownerId !== who.id)
			.map((a) => ({ id: a.id, what: 'model' as const, name: a.name, kind: a.kind, owner: ownerName(a.ownerId!), createdAt: a.createdAt })),
		...listGithubAccounts()
			.filter((a) => a.ownerId && a.ownerId !== who.id)
			.map((a) => ({ id: a.id, what: 'github' as const, name: a.label ?? a.login, kind: a.kind, owner: ownerName(a.ownerId!), createdAt: a.createdAt }))
	];
}

/** Server side: the GitHub connections sessions started by `userId` may use, in full. */
export const usableGithub = (userId: string | null | undefined) => listGithubAccounts().filter((a) => usableBy(userId, a));
