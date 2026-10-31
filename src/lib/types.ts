/** The terminal agent a session runs. */
export type Agent = 'claude' | 'codex' | 'gemini';

/** How a model account connects; see ACCOUNT_KINDS in providers.ts. */
export type AccountKind =
	| 'subscription'
	| 'token'
	| 'api_key'
	| 'bedrock'
	| 'vertex'
	| 'foundry'
	| 'gateway'
	| 'chatgpt'
	| 'openai_api_key'
	| 'google'
	| 'gemini_api_key';

export interface ModelAccount {
	id: string;
	name: string;
	kind: AccountKind;
	agent: Agent;
	/** Non-secret settings: region, project, base URL, model pins… */
	config: Record<string, string>;
	/** Which secret fields are stored (their values never leave the server). */
	secrets: string[];
	/** From the agent's own status check, once signed in. */
	email: string | null;
	plan: string | null;
	status: 'signed_in' | 'signed_out' | 'unknown';
	checkedAt: string | null;
	createdAt: string;
}

/** A preset of account, model and permissions, picked automatically for matching repos. */
export interface Profile {
	id: string;
	name: string;
	accountId: string;
	model: string | null;
	permissionMode: PermissionMode;
	/** owner/name patterns: "acme/*", "acme/api", "*". */
	repos: string[];
	/** AWS profiles sessions on these repos get. */
	awsProfileIds: string[];
	position: number;
}

/** A sign-in to AWS IAM Identity Center (SSO). Orbital keeps its token; sessions never see it. */
export interface AwsLogin {
	id: string;
	label: string | null;
	/** The AWS access portal URL, e.g. https://acme.awsapps.com/start. */
	startUrl: string;
	/** Where Identity Center runs, e.g. us-east-1. */
	ssoRegion: string;
	/** Until when Orbital can get credentials without signing in again. */
	expiresAt: string | null;
	/** Whether it can renew itself when that time comes. */
	renewable: boolean;
	createdAt: string;
}

/** One account and role through an AWS sign-in: what a session's credentials can do. */
export interface AwsProfile {
	id: string;
	/** The profile name inside sessions (AWS_PROFILE, Terraform's profile), e.g. prod-readonly. */
	name: string;
	loginId: string;
	accountId: string;
	accountName: string | null;
	roleName: string;
	/** Default region for commands, e.g. eu-west-1. */
	region: string;
	createdAt: string;
}

export interface GithubAccount {
	id: string;
	/** What the user called this token, e.g. "Work org"; several tokens can share a login. */
	label: string | null;
	login: string;
	name: string | null;
	avatarUrl: string | null;
	kind: 'pat' | 'oauth';
	scopes: string | null;
	/** Organizations the token can see. */
	orgs: string[];
	createdAt: string;
}

/** What one GitHub token gets for a repository, for picking the token a session uses. */
export interface TokenAccess {
	accountId: string;
	/** GitHub returned the repository for this token. */
	ok: boolean;
	/** The highest level in the `permissions` GitHub returned for the repository with this token. */
	access: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | null;
	kind: 'fine-grained' | 'classic' | 'sign-in' | 'unknown';
	/** A classic token's or sign-in's scopes, as GitHub reports them. */
	scopes: string | null;
	/** When the token expires, as GitHub reports it. */
	expires: string | null;
	/** How many repositories the token lists. */
	sees: { repos: number; private: number } | null;
	/** Why GitHub didn't return the repository, when it didn't. */
	reason: string | null;
}

export interface GithubRepo {
	fullName: string;
	owner: string;
	name: string;
	private: boolean;
	defaultBranch: string;
	description: string | null;
	pushedAt: string | null;
	url: string;
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions';

export const PERMISSION_MODES: { value: PermissionMode; label: string; hint: string }[] = [
	{ value: 'default', label: 'Ask', hint: 'Claude asks before edits and commands' },
	{ value: 'acceptEdits', label: 'Accept edits', hint: 'File edits go through; commands still ask' },
	{ value: 'plan', label: 'Plan', hint: 'Read-only until you approve a plan' },
	{ value: 'auto', label: 'Auto', hint: 'A classifier approves safe actions' },
	{ value: 'bypassPermissions', label: 'Bypass', hint: 'No prompts. The container is the sandbox' }
];

export type SessionStatus = 'starting' | 'running' | 'stopped' | 'error';

/** What started a session: a person with a task, a skill or command, or a Linear issue. */
export type SessionKind = 'task' | 'skill' | 'linear';

/** A pull request opened from the session's branch, found on GitHub. */
export interface SessionPr {
	number: number;
	url: string;
	state: 'open' | 'closed' | 'merged' | 'draft';
}

export interface LinearRef {
	issueId: string;
	identifier: string;
	url: string;
}

export interface Session {
	id: string;
	name: string;
	/** Docker container name: orbital-<repo>, with -2, -3… for more sessions on one repo. */
	containerName: string;
	kind: SessionKind;
	/** The skill or command it was started with, e.g. "/code-review 234". */
	skill: string | null;
	/** A pull request checked out at the first start. */
	checkoutPr: number | null;
	/** Follows the session's account. */
	agent: Agent;
	pr: SessionPr | null;
	linear: LinearRef | null;
	/** Empty for a session started without a repo, in an empty folder. */
	repoUrl: string;
	/** owner/name for GitHub repos, null for other URLs. */
	repoFullName: string | null;
	/** Folder name under /workspace. */
	repoDir: string;
	baseBranch: string | null;
	newBranch: string | null;
	accountId: string;
	githubAccountId: string | null;
	/** AWS profiles whose short-lived credentials the session gets. */
	awsProfileIds: string[];
	model: string | null;
	permissionMode: PermissionMode;
	remoteControl: boolean;
	status: SessionStatus;
	containerId: string | null;
	error: string | null;
	/** The claude.ai/code link Remote Control printed, once seen. */
	rcUrl: string | null;
	createdAt: string;
	lastStartedAt: string | null;
	stoppedAt: string | null;
}

export interface SessionInput {
	name: string;
	kind: SessionKind;
	skill: string | null;
	checkoutPr: number | null;
	repoUrl: string;
	repoFullName: string | null;
	baseBranch: string | null;
	newBranch: string | null;
	accountId: string;
	githubAccountId: string | null;
	awsProfileIds: string[];
	model: string | null;
	permissionMode: PermissionMode;
	remoteControl: boolean;
	prompt: string | null;
}

/** What Claude is doing right now, read from the terminal. */
export type PaneState = 'working' | 'waiting' | 'idle' | 'shell' | 'starting' | 'unknown';

export interface Todo {
	content: string;
	status: 'pending' | 'in_progress' | 'completed';
}

/** A short, cheap summary of the newest conversation, read from its transcript. */
export interface TranscriptSummary {
	conversationId: string;
	title: string | null;
	lastPrompt: string | null;
	lastReply: string | null;
	lastTool: string | null;
	messages: number;
	updatedAt: string;
	todos: Todo[];
}

export interface Conversation {
	id: string;
	title: string | null;
	firstPrompt: string | null;
	updatedAt: string;
	messages: number;
	bytes: number;
}

export interface GitState {
	branch: string | null;
	ahead: number;
	behind: number;
	changed: number;
	insertions: number;
	deletions: number;
}

/** Everything the overview and session page show live, per session. */
export interface SessionLive {
	id: string;
	status: SessionStatus;
	state: PaneState;
	/** The last lines of the terminal, plain text. */
	tail: string[];
	rcUrl: string | null;
	/** Links on screen (wrapped ones joined), newest last. */
	links: string[];
	summary: TranscriptSummary | null;
	git: GitState | null;
	/** An AI summary, if one was asked for. */
	aiSummary: { text: string; at: string } | null;
	/** The AWS credentials it was given. */
	aws: SessionAws[];
	at: string;
}

/** One AWS profile's credentials in a session: until when they're good, or why there are none. */
export interface SessionAws {
	profileId: string;
	name: string;
	expiresAt: string | null;
	error: string | null;
}

export interface GithubPull {
	number: number;
	title: string;
	author: string | null;
	draft: boolean;
	headRef: string;
	/** owner/name the branch lives in (a fork, for outside contributions). */
	headRepo: string | null;
	updatedAt: string;
	url: string;
}

/** A skill or slash command a session can start with. */
export interface SkillOption {
	command: string;
	description: string;
	/** Where it comes from: Claude Code itself, or the account's own skills and commands. */
	source: 'built-in' | 'account';
	/** Takes a pull request number. */
	takesPr?: boolean;
}

export interface LinearTeam {
	id: string;
	key: string;
	name: string;
}

export interface LinearRule {
	id: string;
	name: string;
	teamId: string;
	teamKey: string;
	/** null: the account, model and permissions below; "auto": the profile matching the repo; else a profile id. */
	profileId: string | null;
	/** Issues with this label start a session. */
	label: string;
	repo: string;
	githubAccountId: string | null;
	baseBranch: string | null;
	accountId: string;
	model: string | null;
	permissionMode: PermissionMode;
	/** First message; {identifier} {title} {description} {url} {branch} are filled in. */
	prompt: string;
	/** Comment on the issue when a session starts and when its PR opens. */
	comment: boolean;
	/** Move the issue to the team's first "started" state. */
	moveToStarted: boolean;
	enabled: boolean;
	createdAt: string;
	lastCheckedAt: string | null;
	lastError: string | null;
}

export interface LinearRun {
	ruleId: string;
	issueId: string;
	identifier: string;
	title: string;
	url: string;
	sessionId: string | null;
	status: 'started' | 'skipped' | 'error';
	error: string | null;
	createdAt: string;
}

export interface Settings {
	sessionImage: string;
	/** For Codex and Gemini sessions: an image that also has those CLIs. */
	agentsImage: string;
	/** Docker network for session containers (blank: Docker's default bridge). */
	network: string;
	/** Per-container limits; 0 means none. */
	memoryMb: number;
	cpus: number;
	defaultModel: string;
	defaultPermissionMode: PermissionMode;
	defaultRemoteControl: boolean;
	/** Extra KEY=value lines passed to every session container. */
	extraEnv: string;
	/** How Orbital is reached from a browser: links in Linear comments, the SSO callback. */
	publicUrl: string;
	/** A GitHub OAuth app (device flow enabled) for "Sign in with GitHub". */
	githubClientId: string;
}

export interface Viewer {
	email: string;
	name: string | null;
	/** Admins manage sign-in, users and AWS access. */
	admin: boolean;
}

export type UserRole = 'admin' | 'member';
/** local: the email and password made at setup; oidc and proxy: signed in through SSO. */
export type UserSource = 'local' | 'oidc' | 'proxy';

export interface User {
	id: string;
	email: string;
	name: string | null;
	/** Admins also manage sign-in and users; members use everything else. */
	role: UserRole;
	source: UserSource;
	createdAt: string;
	lastLoginAt: string | null;
}

/** Sign-in settings, managed under Settings → Sign-in. */
export interface AuthSettings {
	/** Off: anyone who can reach Orbital uses it as the admin, e.g. behind a proxy that already signs people in. */
	required: boolean;
	/** Show the email and password form. The local admin can always use /login?local. */
	passwordForm: boolean;
	oidc: {
		enabled: boolean;
		/** The provider's issuer URL; its /.well-known/openid-configuration is read from there. */
		issuer: string;
		clientId: string;
		/** Whether a client secret is stored (it never leaves the server). */
		hasSecret: boolean;
		scopes: string;
		/** On the button: "Sign in with {label}". */
		label: string;
		/** The claim listing the user's groups. */
		groupsClaim: string;
	};
	/** Forward auth: a reverse proxy (Authelia, Authentik, oauth2-proxy…) signs people in and passes headers. */
	proxy: {
		enabled: boolean;
		emailHeader: string;
		nameHeader: string;
		groupsHeader: string;
		/** Only requests from these addresses or CIDR ranges are trusted to set the headers. */
		trustedProxies: string[];
		/** Where Sign out goes, to end the proxy's session too. */
		logoutUrl: string;
	};
	/** Who may sign in through SSO, and who becomes an admin. Emails, @domains, or * for anyone. */
	access: {
		allowedEmails: string[];
		allowedGroups: string[];
		adminEmails: string[];
		adminGroups: string[];
	};
}
