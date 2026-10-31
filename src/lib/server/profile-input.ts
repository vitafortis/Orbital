import { BadRequest, str } from './http.ts';
import { getAccount, type ProfileInput } from './store.ts';
import { parseAwsProfileIds, parseModel, parsePermissionMode } from './sessions/input.ts';
import { parsePatterns } from '#lib/profiles.ts';
import { fitPermissionMode } from '#lib/providers.ts';

export function parseProfileInput(b: Record<string, unknown>): ProfileInput {
	const name = str(b, 'name', { required: true, max: 80 })!;
	const accountId = str(b, 'accountId', { required: true })!;
	const account = getAccount(accountId);
	if (!account) throw new BadRequest('Pick a model account');
	const raw = Array.isArray(b.repos) ? b.repos.filter((r) => typeof r === 'string').join('\n') : typeof b.repos === 'string' ? b.repos : '';
	const repos = parsePatterns(raw);
	if (repos.length > 100) throw new BadRequest('Keep it under 100 patterns');
	for (const r of repos) if (r.length > 200 || /\s/.test(r)) throw new BadRequest(`"${r}" isn't a repository pattern`);
	return {
		name,
		accountId,
		model: parseModel(b.model),
		permissionMode: fitPermissionMode(account.agent, parsePermissionMode(b.permissionMode)),
		repos,
		awsProfileIds: parseAwsProfileIds(b.awsProfileIds)
	};
}
