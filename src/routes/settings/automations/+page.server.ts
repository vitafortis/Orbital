import type { PageServerLoad } from './$types';
import { DEFAULT_PROMPT, linearInfo } from '#lib/server/linear.ts';
import { listAccounts, listGithubAccounts, listLinearRules, listLinearRuns, listProfiles, listSessions } from '#lib/server/store.ts';

export const load: PageServerLoad = () => ({
	linear: linearInfo(),
	rules: listLinearRules(),
	runs: listLinearRuns(),
	defaultPrompt: DEFAULT_PROMPT,
	accounts: listAccounts(),
	profiles: listProfiles(),
	githubAccounts: listGithubAccounts(),
	sessionNames: Object.fromEntries(listSessions().map((s) => [s.id, s.name]))
});
