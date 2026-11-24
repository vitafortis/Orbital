import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loginsInProgress } from '#lib/server/accounts.ts';
import { deviceFlowEnabled } from '#lib/server/github.ts';
import { othersOwn } from '#lib/server/owned.ts';
import { getNotionConnection, listAccounts, listAwsLogins, listAwsProfiles, listGithubAccounts, listProfiles } from '#lib/server/store.ts';

/**
 * Your own accounts for everyone who starts sessions; the organization's (and that other people
 * have their own) for admins only.
 */
export const load: PageServerLoad = async ({ locals }) => {
	// Viewers don't start sessions, so they have nothing of their own to sign in.
	if (locals.user?.role === 'viewer') redirect(303, '/settings');
	const me = locals.user?.id ?? null;
	const admin = locals.user?.role === 'admin';
	const mine = <T extends { ownerId: string | null }>(x: T) => (x.ownerId ? x.ownerId === me : admin);
	return {
		// Sign-ins left open, e.g. while the person was on the provider's page in another tab.
		signingIn: await loginsInProgress(),
		accounts: listAccounts().filter(mine),
		profiles: admin ? listProfiles() : [],
		githubAccounts: listGithubAccounts().filter(mine),
		deviceFlow: deviceFlowEnabled(),
		awsLogins: admin ? listAwsLogins() : [],
		awsProfiles: admin ? listAwsProfiles() : [],
		othersOwn: othersOwn(locals.user),
		myNotion: me ? (getNotionConnection(me) ?? null) : null
	};
};
