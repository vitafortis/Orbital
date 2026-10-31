/**
 * Linear automations. A rule says "issues in team T with label L start a session on repo R".
 * Every minute (or on "Check now") each enabled rule looks for matching open issues it
 * hasn't handled yet and starts a session for each: on Linear's own branch name for the
 * issue, so the pull request links back to it, with the issue as the first message.
 * Polling rather than webhooks, so a homelab behind NAT works without exposing anything.
 */
import { config } from './config.ts';
import { BadRequest } from './http.ts';
import { prEvents } from './sessions/prs.ts';
import { launchNewSession } from './sessions/create.ts';
import {
	getAccount,
	getKv,
	getLinearKey,
	getLinearRule,
	getProfile,
	getSettings,
	hasLinearRun,
	linearRunForSession,
	listLinearRules,
	listProfiles,
	recordLinearRun,
	setKv,
	setLinearKey,
	setLinearRuleChecked
} from './store.ts';
import { isValidBranch, parseRepo } from '#lib/launch.ts';
import { matchProfile } from '#lib/profiles.ts';
import { AGENT_LABEL } from '#lib/providers.ts';
import type { LinearRule, LinearTeam } from '#lib/types.ts';

const POLL_MS = 60_000;
// Don't flood the host when a rule suddenly matches many issues.
const MAX_SPAWNS_PER_CHECK = 3;

export const DEFAULT_PROMPT = `You're working on Linear issue {identifier}: {title}
{url}

{description}

You're on the branch {branch}. When the change is done and the checks pass, commit, push, and open a pull request with gh pr create. Put "Fixes {identifier}" in its description so Linear links it.`;

async function gql<T>(query: string, variables: Record<string, unknown> = {}, key = getLinearKey()): Promise<T> {
	if (!key) throw new BadRequest('Connect Linear first');
	const res = await fetch(config.linearApiUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: key, 'user-agent': 'orbital' },
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(20_000)
	});
	const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
	if (res.status === 401 || (res.status === 400 && body.errors?.some((e) => /auth/i.test(e.message)))) {
		throw new BadRequest('Linear rejected the API key');
	}
	if (body.errors?.length) throw new BadRequest(`Linear: ${body.errors[0].message}`);
	if (!res.ok || !body.data) throw new BadRequest(`Linear: ${res.statusText}`);
	return body.data;
}

export type LinearInfo = { connected: boolean; viewer: string | null; organization: string | null; urlKey: string | null };

export function linearInfo(): LinearInfo {
	const info = getKv<Omit<LinearInfo, 'connected'> | null>('linear:info', null);
	return { connected: !!getLinearKey(), viewer: info?.viewer ?? null, organization: info?.organization ?? null, urlKey: info?.urlKey ?? null };
}

export async function connectLinear(key: string): Promise<LinearInfo> {
	const k = key.trim();
	if (!k) throw new BadRequest('Paste a Linear API key');
	const d = await gql<{ viewer: { name: string; email: string }; organization: { name: string; urlKey: string } }>(
		'query { viewer { name email } organization { name urlKey } }',
		{},
		k
	);
	setLinearKey(k);
	setKv('linear:info', { viewer: d.viewer.name || d.viewer.email, organization: d.organization.name, urlKey: d.organization.urlKey });
	return linearInfo();
}

export function disconnectLinear() {
	setLinearKey(null);
	setKv('linear:info', null);
}

export async function listTeams(): Promise<LinearTeam[]> {
	const d = await gql<{ teams: { nodes: LinearTeam[] } }>('query { teams(first: 100) { nodes { id key name } } }');
	return d.teams.nodes.sort((a, b) => a.name.localeCompare(b.name));
}

/** Label names, for suggestions (workspace labels and the team's). */
export async function listLabels(teamId: string | null): Promise<string[]> {
	const d = await gql<{ issueLabels: { nodes: { name: string; team: { id: string } | null }[] } }>(
		'query { issueLabels(first: 250) { nodes { name team { id } } } }'
	);
	return [...new Set(d.issueLabels.nodes.filter((l) => !l.team || l.team.id === teamId).map((l) => l.name))].sort();
}

export type LinearIssue = {
	id: string;
	identifier: string;
	title: string;
	description: string | null;
	url: string;
	branchName: string;
	state: { type: string };
};

async function matchingIssues(rule: Pick<LinearRule, 'teamId' | 'label'>): Promise<LinearIssue[]> {
	const d = await gql<{ issues: { nodes: LinearIssue[] } }>(
		`query($team: ID!, $label: String!) {
			issues(first: 50, orderBy: createdAt, filter: {
				team: { id: { eq: $team } }
				labels: { some: { name: { eqIgnoreCase: $label } } }
				state: { type: { nin: ["completed", "canceled"] } }
			}) { nodes { id identifier title description url branchName state { type } } }
		}`,
		{ team: rule.teamId, label: rule.label }
	);
	return d.issues.nodes;
}

/** Marks what a new rule already matches as handled, so only issues labelled from now on start sessions. */
export async function skipExisting(rule: LinearRule) {
	for (const i of await matchingIssues(rule)) {
		recordLinearRun({ ruleId: rule.id, issueId: i.id, identifier: i.identifier, title: i.title, url: i.url, sessionId: null, status: 'skipped', error: null });
	}
}

export function renderPrompt(template: string, issue: Pick<LinearIssue, 'identifier' | 'title' | 'description' | 'url'>, branch: string): string {
	const values: Record<string, string> = {
		identifier: issue.identifier,
		title: issue.title,
		description: (issue.description ?? '').slice(0, 8000).trim() || '(No description.)',
		url: issue.url,
		branch
	};
	return template.replace(/\{(identifier|title|description|url|branch)\}/g, (_, k: string) => values[k]);
}

async function comment(issueId: string, body: string) {
	await gql('mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }', { input: { issueId, body } });
}

/** Moves an issue that hasn't started yet to the team's first "started" state. */
async function moveToStarted(teamId: string, issue: LinearIssue) {
	if (!['backlog', 'unstarted', 'triage'].includes(issue.state.type)) return;
	const d = await gql<{ team: { states: { nodes: { id: string; type: string; position: number }[] } } }>(
		'query($id: String!) { team(id: $id) { states { nodes { id type position } } } }',
		{ id: teamId }
	);
	const started = d.team.states.nodes.filter((s) => s.type === 'started').sort((a, b) => a.position - b.position)[0];
	if (started) await gql('mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }', { id: issue.id, state: started.id });
}

/** The address of Orbital for links in comments: Settings, or the last one a browser used. */
export function publicUrl(): string | null {
	return getSettings().publicUrl || getKv<string | null>('origin:last', null);
}

let lastOrigin: string | null = null;
export function rememberOrigin(origin: string) {
	if (origin === lastOrigin) return;
	lastOrigin = origin;
	setKv('origin:last', origin);
}

async function spawn(rule: LinearRule, issue: LinearIssue) {
	const repo = parseRepo(rule.repo);
	if (!repo) throw new Error(`"${rule.repo}" isn't a repository`);
	const branch = isValidBranch(issue.branchName) ? issue.branchName : `claude/${issue.identifier.toLowerCase()}`;
	// A profile (chosen, or the one matching the repo) stands in for the rule's own choices.
	const profile = rule.profileId === 'auto' ? matchProfile(listProfiles(), repo.fullName ?? repo.url) : rule.profileId ? getProfile(rule.profileId) : null;
	const accountId = profile && getAccount(profile.accountId) ? profile.accountId : rule.accountId;
	const session = await launchNewSession(
		{
			name: `${issue.identifier} ${issue.title}`.slice(0, 80).trim(),
			kind: 'linear',
			skill: null,
			checkoutPr: null,
			repoUrl: repo.url,
			repoFullName: repo.fullName,
			repoDir: repo.dir,
			baseBranch: rule.baseBranch,
			newBranch: branch,
			accountId,
			githubAccountId: rule.githubAccountId,
			awsProfileIds: profile?.awsProfileIds ?? [],
			model: profile ? profile.model : rule.model,
			permissionMode: profile?.permissionMode ?? rule.permissionMode,
			remoteControl: getSettings().defaultRemoteControl,
			prompt: renderPrompt(rule.prompt, issue, branch)
		},
		{ linear: { issueId: issue.id, identifier: issue.identifier, url: issue.url } }
	);
	recordLinearRun({ ruleId: rule.id, issueId: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url, sessionId: session.id, status: 'started', error: null });
	// Linear updates are a courtesy: a failure here shouldn't undo the session.
	const notes: string[] = [];
	if (rule.moveToStarted) await moveToStarted(rule.teamId, issue).catch((e) => notes.push(`move: ${e.message}`));
	if (rule.comment) {
		const base = publicUrl();
		const where = base ? `[${session.name}](${base}/s/${session.id})` : `“${session.name}”`;
		await comment(issue.id, `🤖 ${AGENT_LABEL[getAccount(accountId)?.agent ?? 'claude']} started on this in Orbital: ${where}, on branch \`${branch}\`.`).catch((e) => notes.push(`comment: ${e.message}`));
	}
	if (notes.length) console.warn(`[orbital] Linear ${issue.identifier}: ${notes.join('; ')}`);
}

let running = false;

/** One pass over the enabled rules (or just one). Returns how many sessions started. */
export async function checkRules(onlyRuleId?: string): Promise<number> {
	if (running || !getLinearKey()) return 0;
	running = true;
	let started = 0;
	try {
		const rules = listLinearRules().filter((r) => (onlyRuleId ? r.id === onlyRuleId : r.enabled));
		for (const rule of rules) {
			try {
				for (const issue of await matchingIssues(rule)) {
					if (hasLinearRun(rule.id, issue.id)) continue;
					if (started >= MAX_SPAWNS_PER_CHECK) break;
					try {
						await spawn(rule, issue);
						started++;
					} catch (err) {
						const error = err instanceof Error ? err.message : String(err);
						recordLinearRun({ ruleId: rule.id, issueId: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url, sessionId: null, status: 'error', error });
					}
				}
				setLinearRuleChecked(rule.id, null);
			} catch (err) {
				setLinearRuleChecked(rule.id, err instanceof Error ? err.message : String(err));
			}
		}
	} finally {
		running = false;
	}
	return started;
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startLinear() {
	if (timer) return;
	timer = setInterval(() => void checkRules(), POLL_MS);
	timer.unref?.();
	// Tell the issue when its pull request opens.
	prEvents.on('opened', (s, pr) => {
		if (!s.linear) return;
		const run = linearRunForSession(s.id);
		const rule = run && getLinearRule(run.ruleId);
		if (!rule?.comment || !getLinearKey()) return;
		void comment(s.linear.issueId, `🔀 Pull request opened: ${pr.url}`).catch(() => {});
	});
}
