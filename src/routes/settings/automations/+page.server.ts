import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { DEFAULT_PROMPT, linearInfo } from '#lib/server/linear.ts';
import { getSettings, listAccounts, listGithubAccounts, listLinearRules, listLinearRuns, listProfiles, listSessions } from '#lib/server/store.ts';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user?.role !== 'admin') redirect(303, '/settings/accounts');
	const settings = getSettings();
	return {
		linear: linearInfo(),
		rules: listLinearRules(),
		runs: listLinearRuns(),
		defaultPrompt: DEFAULT_PROMPT,
		// Automations run as nobody in particular: the organization's accounts only.
		accounts: listAccounts().filter((a) => !a.ownerId),
		profiles: listProfiles(),
		githubAccounts: listGithubAccounts().filter((a) => !a.ownerId),
		// What empty means in a rule's expiry fields.
		expiryDefaults: { autoIdleStopHours: settings.autoIdleStopHours, autoDeleteStoppedDays: settings.autoDeleteStoppedDays },
		sessionNames: Object.fromEntries(listSessions().map((s) => [s.id, s.name]))
	};
};
