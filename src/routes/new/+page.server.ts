import type { PageServerLoad } from './$types';
import { accountsFor, githubAccountsFor } from '#lib/server/owned.ts';
import { getSettings, listAwsProfiles, listProfiles } from '#lib/server/store.ts';

export const load: PageServerLoad = ({ locals }) => ({
	// The organization's and your own.
	accounts: accountsFor(locals.user),
	profiles: listProfiles(),
	githubAccounts: githubAccountsFor(locals.user),
	awsProfiles: listAwsProfiles(),
	settings: getSettings()
});
