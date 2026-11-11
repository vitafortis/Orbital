import type { GithubAccount } from './types.ts';

/**
 * What a GitHub connection lets a session do, when GitHub says (a GitHub App's installation
 * permissions; tokens and sign-ins don't report theirs): push code, only review and comment on
 * pull requests, or only read. Null when it isn't known.
 */
export type GithubAccess = 'write' | 'review' | 'read';

export function githubAccess(a: Pick<GithubAccount, 'kind' | 'permissions'>): GithubAccess | null {
	if (a.kind !== 'app' || !a.permissions) return null;
	if (a.permissions.contents === 'write') return 'write';
	return a.permissions.pull_requests === 'write' ? 'review' : 'read';
}

export const GITHUB_ACCESS_LABEL: Record<GithubAccess, string> = { write: 'Can push', review: 'Review only', read: 'Read only' };

/** What Claude is told at launch when its GitHub access can't push, so it doesn't spend turns trying. */
export function accessNote(access: GithubAccess | null): string | null {
	if (access === 'read') {
		return "This session's GitHub access is read-only: you can clone, fetch and read pull requests, but not push, open pull requests or comment. Don't try. Give changes as a unified diff in your reply, and put anything that needs write access on the user's To do list.";
	}
	if (access === 'review') {
		return "This session's GitHub access can review and comment on pull requests (gh pr review, gh pr comment) but can't push code or create branches on GitHub. Don't try to push. Give code changes as suggestions in review comments or as a unified diff in your reply.";
	}
	return null;
}
