import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { accountsFor, githubAccountsFor } from '#lib/server/owned.ts';
import { getSession, getUser, listAwsProfiles } from '#lib/server/store.ts';
import { listConversations } from '#lib/server/sessions/transcripts.ts';

export const load: PageServerLoad = ({ params, locals }) => {
	const session = getSession(params.id);
	if (!session) error(404, 'Session not found');
	// The conversation list is rendered with the page, so the panel doesn't fill in after it.
	const conversations = session.agent === 'claude' ? listConversations(session) : [];
	// What the session can switch to: its owner's choices, as the person looking may see them.
	const owner = session.ownerId ? (getUser(session.ownerId) ?? null) : null;
	const who = locals.user?.role === 'admin' && owner ? { id: owner.id, role: 'admin' as const } : owner;
	return { session, accounts: accountsFor(who), githubAccounts: githubAccountsFor(who), awsProfiles: listAwsProfiles(), conversations };
};
