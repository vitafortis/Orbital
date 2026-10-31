import { BadRequest, str } from '../http.ts';
import { getAccount, getAwsProfile, getGithubAccount } from '../store.ts';
import { fitPermissionMode } from '#lib/providers.ts';
import { isValidBranch, parseRepo, repoDirName, slugify, type LaunchMode } from '#lib/launch.ts';
import { PERMISSION_MODES, type PermissionMode, type SessionInput } from '#lib/types.ts';

const MODEL = /^[A-Za-z0-9._[\]-]{1,80}$/;

export function parsePermissionMode(v: unknown): PermissionMode {
	if (v === undefined || v === null || v === '') return 'default';
	if (!PERMISSION_MODES.some((m) => m.value === v)) throw new BadRequest('Unknown permission mode');
	return v as PermissionMode;
}

export function parseModel(v: unknown): string | null {
	if (v === undefined || v === null || v === '') return null;
	if (typeof v !== 'string' || !MODEL.test(v.trim())) throw new BadRequest('Model must be an alias like opus or sonnet, or a model name');
	return v.trim();
}

export function parseName(v: unknown): string {
	if (typeof v !== 'string' || !v.trim()) throw new BadRequest('Give the session a name');
	const name = v.trim().replace(/\s+/g, ' ');
	if (name.length > 80) throw new BadRequest('Keep the name under 80 characters');
	return name;
}

/** AWS profile ids, each one that exists. */
export function parseAwsProfileIds(v: unknown): string[] {
	if (v === undefined || v === null) return [];
	if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new BadRequest('AWS profiles must be a list');
	const ids = [...new Set(v as string[])];
	for (const id of ids) if (!getAwsProfile(id)) throw new BadRequest('That AWS profile no longer exists');
	return ids;
}

// A slash command or skill: /code-review, /security-review, /my-plugin:skill…
const COMMAND = /^\/[A-Za-z0-9][A-Za-z0-9:_.-]{0,80}$/;

export function parseSessionInput(b: Record<string, unknown>): SessionInput & { repoDir: string } {
	// No repo: the session starts in an empty folder (git initialised) named after the session.
	const typed = str(b, 'repo');
	const repo = typed ? parseRepo(typed) : null;
	if (typed && !repo) throw new BadRequest('Enter a GitHub repository (owner/name) or an https git URL');
	if (!repo && typeof b.name !== 'string') throw new BadRequest('Name the session: without a repo, its folder is named after it');

	const accountId = str(b, 'accountId', { required: true })!;
	const account = getAccount(accountId);
	if (!account) throw new BadRequest('Pick a model account');
	const githubAccountId = str(b, 'githubAccountId');
	if (githubAccountId && !getGithubAccount(githubAccountId)) throw new BadRequest('That GitHub account no longer exists');

	const kind = b.kind === 'skill' ? 'skill' : 'task';
	let skill: string | null = null;
	if (kind === 'skill') {
		if (account.agent !== 'claude') throw new BadRequest('Skills run in Claude Code. Pick a Claude account for this session.');
		const command = str(b, 'command', { required: true, max: 82 })!;
		if (!COMMAND.test(command)) throw new BadRequest('A skill or command starts with "/", e.g. /code-review');
		const args = (str(b, 'args', { max: 2000 }) ?? '').replace(/\s+/g, ' ');
		skill = args ? `${command} ${args}` : command;
	}

	let checkoutPr: number | null = null;
	if (b.checkoutPr !== undefined && b.checkoutPr !== null && b.checkoutPr !== '') {
		checkoutPr = Number(b.checkoutPr);
		if (!Number.isInteger(checkoutPr) || checkoutPr < 1) throw new BadRequest('Pull request must be a number');
		if (!repo?.fullName) throw new BadRequest('Pull requests can only be checked out from GitHub repositories');
	}

	const baseBranch = str(b, 'baseBranch', { max: 200 });
	const newBranch = str(b, 'newBranch', { max: 200 });
	for (const br of [baseBranch, newBranch]) if (br && !isValidBranch(br)) throw new BadRequest(`"${br}" isn't a valid branch name`);
	if (!repo && baseBranch) throw new BadRequest('Without a repo there is no branch to start from');

	const dir = repo?.dir ?? '';
	const defaultName = skill ? `${dir} ${skill.split(' ')[0].slice(1)}${checkoutPr ? ` #${checkoutPr}` : ''}` : dir;
	const name = parseName(b.name ?? defaultName);
	return {
		name,
		kind,
		skill,
		checkoutPr,
		repoUrl: repo?.url ?? '',
		repoFullName: repo?.fullName ?? null,
		repoDir: repo?.dir ?? (repoDirName(slugify(name, 60)) || 'workspace'),
		baseBranch,
		newBranch,
		accountId,
		githubAccountId,
		awsProfileIds: parseAwsProfileIds(b.awsProfileIds),
		model: parseModel(b.model),
		permissionMode: fitPermissionMode(account.agent, parsePermissionMode(b.permissionMode)),
		remoteControl: b.remoteControl !== false,
		// A skill session's first message is the command itself.
		prompt: skill ?? str(b, 'prompt', { max: 20_000 })
	};
}

/** {mode: 'new' | 'continue' | 'resume', conversationId} from a start/relaunch request. */
export function parseLaunch(b: Record<string, unknown>): LaunchMode | undefined {
	if (b.mode === 'new') return { mode: 'new', prompt: str(b, 'prompt', { max: 20_000 }) };
	if (b.mode === 'continue') return { mode: 'continue' };
	if (b.mode === 'resume') {
		const id = str(b, 'conversationId', { required: true })!;
		if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequest('Invalid conversation id');
		return { mode: 'resume', conversationId: id };
	}
	return undefined;
}
