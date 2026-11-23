import type { PageServerLoad } from './$types';
import { loginsInProgress } from '#lib/server/accounts.ts';
import { deviceFlowEnabled } from '#lib/server/github.ts';
import { listAccounts, listAwsLogins, listAwsProfiles, listGithubAccounts, listProfiles } from '#lib/server/store.ts';

export const load: PageServerLoad = async () => ({
	// Sign-ins left open, e.g. while the person was on the provider's page in another tab.
	signingIn: await loginsInProgress(),
	accounts: listAccounts(),
	profiles: listProfiles(),
	githubAccounts: listGithubAccounts(),
	deviceFlow: deviceFlowEnabled(),
	awsLogins: listAwsLogins(),
	awsProfiles: listAwsProfiles()
});
