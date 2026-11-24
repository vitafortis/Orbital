import { BadRequest, str } from './http.ts';
import { DEFAULT_PROMPT } from './linear.ts';
import { parseModel, parsePermissionMode } from './sessions/input.ts';
import { requireOrgAccount } from './owned.ts';
import { getAccount, getGithubAccount, getProfile, type LinearRuleInput } from './store.ts';
import { isValidBranch, parseRepo } from '#lib/launch.ts';

export function parseRuleInput(b: Record<string, unknown>): LinearRuleInput {
	const repo = str(b, 'repo', { required: true })!;
	if (!parseRepo(repo)) throw new BadRequest('Enter the repository as owner/name or an https git URL');
	const accountId = str(b, 'accountId', { required: true })!;
	if (!getAccount(accountId)) throw new BadRequest('Pick a model account');
	requireOrgAccount(getAccount(accountId));
	let profileId = str(b, 'profileId');
	if (profileId && profileId !== 'auto' && !getProfile(profileId)) throw new BadRequest('That profile no longer exists');
	profileId ||= null;
	const githubAccountId = str(b, 'githubAccountId');
	if (githubAccountId && !getGithubAccount(githubAccountId)) throw new BadRequest('That GitHub account no longer exists');
	if (githubAccountId) requireOrgAccount(getGithubAccount(githubAccountId), 'GitHub connection');
	const baseBranch = str(b, 'baseBranch', { max: 200 });
	if (baseBranch && !isValidBranch(baseBranch)) throw new BadRequest(`"${baseBranch}" isn't a valid branch name`);
	const teamId = str(b, 'teamId', { required: true })!;
	const teamKey = str(b, 'teamKey', { required: true, max: 20 })!;
	const label = str(b, 'label', { required: true, max: 80 })!;
	return {
		name: str(b, 'name', { max: 80 }) ?? `${teamKey} · ${label}`,
		teamId,
		teamKey,
		profileId,
		label,
		repo,
		githubAccountId,
		baseBranch,
		accountId,
		model: parseModel(b.model),
		permissionMode: parsePermissionMode(b.permissionMode),
		prompt: str(b, 'prompt', { max: 10_000 }) ?? DEFAULT_PROMPT,
		comment: b.comment !== false,
		moveToStarted: b.moveToStarted !== false,
		enabled: b.enabled !== false
	};
}
