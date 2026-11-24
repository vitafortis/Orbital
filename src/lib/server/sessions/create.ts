import { randomUUID } from 'node:crypto';
import { accountForSession, githubAccountForSession } from '../owned.ts';
import { getPull } from '../github.ts';
import { createSession, getAccount, getGithubAccount } from '../store.ts';
import { fitPermissionMode } from '#lib/providers.ts';
import { pokeLive } from './live.ts';
import { allocateContainerName, startSession } from './runtime.ts';
import type { LinearRef, Session, SessionInput } from '#lib/types.ts';

/**
 * Saves a new session and starts it in the background (the first start may pull the
 * image). Used by the New session page (with who started it) and by Linear rules.
 */
export async function launchNewSession(
	input: SessionInput & { repoDir: string },
	extra: { linear?: LinearRef; ownerId?: string | null; shared?: boolean } = {}
): Promise<Session> {
	const { prompt, ...rest } = input;
	// Its owner's own accounts and the organization's; a shared one's or an automation's, the
	// organization's only.
	const user = extra.shared ? null : (extra.ownerId ?? null);
	accountForSession(rest.accountId, user);
	githubAccountForSession(rest.githubAccountId, user);
	const account = getAccount(rest.accountId);
	if (account) rest.permissionMode = fitPermissionMode(account.agent, rest.permissionMode);
	if (rest.checkoutPr && rest.repoFullName && !rest.baseBranch) {
		// A PR from this repo: clone its branch, so commits push straight to the PR.
		// From a fork (or if GitHub can't say), orb-launch fetches pull/<n>/head instead.
		try {
			const pr = await getPull(rest.githubAccountId ? (getGithubAccount(rest.githubAccountId) ?? null) : null, rest.repoFullName, rest.checkoutPr);
			if (pr.headRepo?.toLowerCase() === rest.repoFullName.toLowerCase()) rest.baseBranch = pr.headRef;
		} catch {}
	}
	const containerName = await allocateContainerName(rest.repoDir);
	const session = createSession(randomUUID(), { ...rest, containerName, linear: extra.linear ?? null, ownerId: extra.ownerId ?? null, shared: extra.shared });
	void startSession(session.id, { mode: 'new', prompt })
		.catch(() => {})
		.finally(pokeLive);
	return { ...session, status: 'starting' };
}
