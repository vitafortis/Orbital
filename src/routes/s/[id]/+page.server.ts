import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canWatch } from '#lib/access.ts';
import { othersSessions } from '#lib/server/auth-config.ts';
import { accountsFor, githubAccountsFor } from '#lib/server/owned.ts';
import { getAccount, getGithubAccount, getNotionConnection, getSession, getSettings, getUser, listAwsProfiles } from '#lib/server/store.ts';
import { listConversations } from '#lib/server/sessions/transcripts.ts';
import type { RunsAs } from '#lib/types.ts';

export const load: PageServerLoad = ({ params, locals }) => {
	const session = getSession(params.id);
	if (!session) error(404, 'Session not found');
	const others = othersSessions();
	if (!canWatch(locals.user, session, others)) {
		// Someone else's, by name only (or not at all): the page says whose, and nothing of what's in it.
		if (others === 'hidden') error(404, 'Session not found');
		const owner = session.ownerId ? getUser(session.ownerId) : undefined;
		return { session: { ...session, skill: null, rcUrl: null, error: null, linear: null }, watch: false as const, ownerName: owner ? (owner.name ?? owner.email) : null, accounts: [], githubAccounts: [], awsProfiles: [], conversations: [], runsAs: null, expiryDefaults: null };
	}
	// The conversation list is rendered with the page, so the panel doesn't fill in after it.
	const conversations = session.agent === 'claude' ? listConversations(session) : [];
	const owner = session.ownerId && session.ownerId !== 'open' ? (getUser(session.ownerId) ?? null) : null;
	const ownerName = owner ? (owner.name ?? owner.email) : null;
	// What the session can switch to: its owner's choices (none of anyone's own once it's shared),
	// as the person looking may see them.
	const as = session.shared ? null : owner;
	const who = { id: as?.id ?? '', role: locals.user?.role === 'admin' ? ('admin' as const) : ('member' as const) };
	// What it runs as, and whose each is: the organization's, or its owner's own.
	const account = getAccount(session.accountId);
	const github = session.githubAccountId ? getGithubAccount(session.githubAccountId) : undefined;
	const awsProfiles = listAwsProfiles();
	const runsAs: RunsAs = {
		model: account ? { name: account.name, kind: account.kind, own: !!account.ownerId } : null,
		github: github ? { name: github.label ?? github.login, login: github.login, own: !!github.ownerId } : null,
		notion: !session.shared && !!owner && !!getNotionConnection(owner.id),
		aws: awsProfiles.filter((p) => session.awsProfileIds.includes(p.id)).map((p) => p.name)
	};
	// What its expiry fields mean when empty: the defaults for its kind (Settings → General).
	const st = getSettings();
	const expiryDefaults = session.linear ? { idleStopHours: st.autoIdleStopHours, deleteStoppedDays: st.autoDeleteStoppedDays } : { idleStopHours: st.idleStopHours, deleteStoppedDays: st.deleteStoppedDays };
	return { session, watch: true as const, ownerName, accounts: accountsFor(who), githubAccounts: githubAccountsFor(who), awsProfiles, conversations, runsAs, expiryDefaults };
};
