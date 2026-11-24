import type { PageServerLoad } from './$types';
import { loginsInProgress } from '#lib/server/accounts.ts';
import { accountsFor, githubAccountsFor } from '#lib/server/owned.ts';

export const load: PageServerLoad = async ({ locals }) => ({
	accounts: accountsFor(locals.user).map(({ id, name, kind, status }) => ({ id, name, kind, status })),
	signingIn: await loginsInProgress(),
	githubAccounts: githubAccountsFor(locals.user).length
});
