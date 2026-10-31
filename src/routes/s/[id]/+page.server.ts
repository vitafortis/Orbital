import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSession, listAccounts, listAwsProfiles, listGithubAccounts } from '#lib/server/store.ts';
import { listConversations } from '#lib/server/sessions/transcripts.ts';

export const load: PageServerLoad = ({ params }) => {
	const session = getSession(params.id);
	if (!session) error(404, 'Session not found');
	// The conversation list is rendered with the page, so the panel doesn't fill in after it.
	const conversations = session.agent === 'claude' ? listConversations(session) : [];
	return { session, accounts: listAccounts(), githubAccounts: listGithubAccounts(), awsProfiles: listAwsProfiles(), conversations };
};
