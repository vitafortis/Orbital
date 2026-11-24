/**
 * The kinds of model account Orbital can run sessions with. Each kind belongs to an agent
 * (the CLI that runs in the session's terminal) and declares the fields its form asks for.
 * Secret fields are stored encrypted and never sent back to the browser.
 *
 * Non-Claude models run through their own vendors' agents (Codex CLI, Gemini CLI): Claude Code
 * itself only supports Claude models, whether from Anthropic or a cloud provider.
 */
import type { AccountKind, Agent, PermissionMode } from './types.ts';

export type FieldSpec = {
	key: string;
	label: string;
	secret?: boolean;
	required?: boolean;
	placeholder?: string;
	help?: string;
	multiline?: boolean;
	options?: { value: string; label: string }[];
	default?: string;
};

export type KindSpec = {
	agent: Agent;
	label: string;
	group: 'Anthropic' | 'Claude on your cloud' | 'OpenAI' | 'Google';
	description: string;
	fields: FieldSpec[];
	/** Signs in from a terminal in the browser instead of with a pasted secret. */
	signIn?: boolean;
	/** A sign-in to someone's own plan: the kinds a person can add as their own. */
	personal?: boolean;
	remoteControl?: boolean;
};

export const AGENT_LABEL: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex CLI', gemini: 'Gemini CLI' };

// Optional model pins for Claude on a cloud provider or gateway (ANTHROPIC_DEFAULT_*_MODEL).
const PINS: FieldSpec[] = [
	{ key: 'opusModel', label: 'Opus model ID', placeholder: 'Provider default', help: 'What the opus alias means on this provider' },
	{ key: 'sonnetModel', label: 'Sonnet model ID', placeholder: 'Provider default' },
	{ key: 'haikuModel', label: 'Haiku model ID', placeholder: 'Provider default', help: 'Also used for background tasks such as session titles' }
];

export const ACCOUNT_KINDS: Record<AccountKind, KindSpec> = {
	subscription: {
		personal: true,
		agent: 'claude',
		label: 'Claude subscription',
		group: 'Anthropic',
		description: 'Sign in with your Pro or Max plan in a terminal here. Supports Remote Control.',
		fields: [],
		signIn: true,
		remoteControl: true
	},
	token: {
		personal: true,
		agent: 'claude',
		label: 'Long-lived token',
		group: 'Anthropic',
		description: 'A token from `claude setup-token`, billed to your plan. No Remote Control.',
		fields: [{ key: 'token', label: 'Token', secret: true, required: true, placeholder: 'sk-ant-oat01-…' }]
	},
	api_key: {
		agent: 'claude',
		label: 'Anthropic API key',
		group: 'Anthropic',
		description: 'A Claude Console key, billed per use.',
		fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true, placeholder: 'sk-ant-api03-…' }]
	},
	bedrock: {
		agent: 'claude',
		label: 'Amazon Bedrock',
		group: 'Claude on your cloud',
		description: 'Claude models from your AWS account: a Bedrock API key, or an access key and secret.',
		fields: [
			{ key: 'region', label: 'AWS region', required: true, default: 'us-east-1', placeholder: 'us-east-1' },
			{ key: 'bearerToken', label: 'Bedrock API key', secret: true, help: 'Or leave empty and use an access key below' },
			{ key: 'accessKeyId', label: 'Access key ID', placeholder: 'AKIA…' },
			{ key: 'secretAccessKey', label: 'Secret access key', secret: true },
			...PINS
		]
	},
	vertex: {
		agent: 'claude',
		label: 'Google Vertex AI',
		group: 'Claude on your cloud',
		description: 'Claude models from your Google Cloud project, with a service account key.',
		fields: [
			{ key: 'projectId', label: 'Project ID', required: true },
			{ key: 'region', label: 'Region', required: true, default: 'global', placeholder: 'global, us-east5…' },
			{ key: 'serviceAccount', label: 'Service account key (JSON)', secret: true, required: true, multiline: true },
			...PINS
		]
	},
	foundry: {
		agent: 'claude',
		label: 'Microsoft Foundry',
		group: 'Claude on your cloud',
		description: 'Claude deployments in your Azure Foundry resource.',
		fields: [
			{ key: 'resource', label: 'Resource name', required: true, placeholder: 'my-resource' },
			{ key: 'apiKey', label: 'API key', secret: true, required: true },
			...PINS
		]
	},
	gateway: {
		agent: 'claude',
		label: 'LLM gateway',
		group: 'Claude on your cloud',
		description: 'An Anthropic-compatible gateway (LiteLLM, Portkey…) in front of Claude models.',
		fields: [
			{ key: 'baseUrl', label: 'Base URL', required: true, placeholder: 'https://llm.home.arpa' },
			{ key: 'token', label: 'Credential', secret: true, required: true },
			{
				key: 'header',
				label: 'Sent as',
				default: 'bearer',
				options: [
					{ value: 'bearer', label: 'Authorization: Bearer (ANTHROPIC_AUTH_TOKEN)' },
					{ value: 'x-api-key', label: 'x-api-key (ANTHROPIC_API_KEY)' }
				]
			},
			...PINS
		]
	},
	chatgpt: {
		personal: true,
		agent: 'codex',
		label: 'ChatGPT plan (Codex)',
		group: 'OpenAI',
		description: 'Codex CLI with your ChatGPT Plus, Pro or Business plan. Sign in with a device code here.',
		fields: [],
		signIn: true
	},
	openai_api_key: {
		agent: 'codex',
		label: 'OpenAI API key (Codex)',
		group: 'OpenAI',
		description: 'Codex CLI billed per use to your OpenAI API account.',
		fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true, placeholder: 'sk-…' }]
	},
	google: {
		personal: true,
		agent: 'gemini',
		label: 'Google account (Gemini)',
		group: 'Google',
		description: 'Gemini CLI with your Google account. Sign in from a terminal here.',
		fields: [],
		signIn: true
	},
	gemini_api_key: {
		agent: 'gemini',
		label: 'Gemini API key',
		group: 'Google',
		description: 'Gemini CLI with a key from Google AI Studio.',
		fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true }]
	}
};

export const kindAgent = (kind: AccountKind | null | undefined): Agent => (kind ? ACCOUNT_KINDS[kind]?.agent ?? 'claude' : 'claude');

export const isAccountKind = (v: unknown): v is AccountKind => typeof v === 'string' && v in ACCOUNT_KINDS;

/** Which permission modes mean something for an agent (Codex has no plan or auto mode). */
export const AGENT_PERMISSION_MODES: Record<Agent, PermissionMode[]> = {
	claude: ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'],
	codex: ['default', 'bypassPermissions'],
	gemini: ['default', 'acceptEdits', 'plan', 'bypassPermissions']
};

/** The closest mode an agent has (e.g. a Linear rule's "accept edits" on a Codex account). */
export function fitPermissionMode(agent: Agent, mode: PermissionMode): PermissionMode {
	if (AGENT_PERMISSION_MODES[agent].includes(mode)) return mode;
	return agent === 'gemini' && mode === 'auto' ? 'acceptEdits' : 'default';
}
