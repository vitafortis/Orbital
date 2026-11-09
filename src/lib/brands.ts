/**
 * Brand logos, so a service shows its own mark instead of a generic icon. AI providers come
 * from LobeHub's icon set (MIT), the rest from Simple Icons (CC0). Only the logos named here
 * end up in the bundle. The marks belong to their owners; they're shown to name the service.
 */
import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg?raw';
import azureai from '@lobehub/icons-static-svg/icons/azureai-color.svg?raw';
import bedrock from '@lobehub/icons-static-svg/icons/bedrock-color.svg?raw';
import claude from '@lobehub/icons-static-svg/icons/claude-color.svg?raw';
import codex from '@lobehub/icons-static-svg/icons/codex.svg?raw';
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg?raw';
import google from '@lobehub/icons-static-svg/icons/google-color.svg?raw';
import microsoft from '@lobehub/icons-static-svg/icons/microsoft-color.svg?raw';
import openai from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import vertexai from '@lobehub/icons-static-svg/icons/vertexai-color.svg?raw';
import { siAuth0, siAuthelia, siAuthentik, siCloudflare, siGithub, siKeycloak, siLinear, siNotion, siOkta, siTailscale } from 'simple-icons';
import type { AccountKind, Agent } from './types.ts';

/** Simple Icons gives a path; draw it in the brand colour, or the text colour for black logos. */
function simple(icon: { path: string; hex: string; title: string }, mono = false): string {
	return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="${mono ? 'currentColor' : `#${icon.hex}`}"><title>${icon.title}</title><path d="${icon.path}"/></svg>`;
}

export const BRANDS = {
	anthropic,
	azureai,
	bedrock,
	claude,
	codex,
	gemini,
	google,
	microsoft,
	openai,
	vertexai,
	// Near-black marks follow the text colour so they show in the dark theme.
	github: simple(siGithub, true),
	linear: simple(siLinear),
	notion: simple(siNotion, true),
	authentik: simple(siAuthentik),
	authelia: simple(siAuthelia, true),
	keycloak: simple(siKeycloak, true),
	okta: simple(siOkta),
	auth0: simple(siAuth0),
	tailscale: simple(siTailscale, true),
	cloudflare: simple(siCloudflare)
} as const;

export type Brand = keyof typeof BRANDS;

export const AGENT_BRAND: Record<Agent, Brand> = { claude: 'claude', codex: 'codex', gemini: 'gemini' };

/** The provider's own mark; a gateway is whatever sits behind it, so it has none. */
export const KIND_BRAND: Record<AccountKind, Brand | null> = {
	subscription: 'claude',
	token: 'claude',
	api_key: 'anthropic',
	bedrock: 'bedrock',
	vertex: 'vertexai',
	foundry: 'azureai',
	gateway: null,
	chatgpt: 'openai',
	openai_api_key: 'openai',
	google: 'google',
	gemini_api_key: 'gemini'
};

export const GROUP_BRAND: Record<string, Brand | null> = { Anthropic: 'anthropic', 'Claude on your cloud': null, OpenAI: 'openai', Google: 'google' };

/** A sign-on button's logo, from the label someone gave it ("Authentik", "Google"…). */
export function brandForLabel(label: string): Brand | null {
	const l = label.toLowerCase();
	const known: [string, Brand][] = [
		['authentik', 'authentik'],
		['authelia', 'authelia'],
		['keycloak', 'keycloak'],
		['okta', 'okta'],
		['auth0', 'auth0'],
		['tailscale', 'tailscale'],
		['cloudflare', 'cloudflare'],
		['github', 'github'],
		['google', 'google'],
		['microsoft', 'microsoft'],
		['entra', 'microsoft'],
		['azure', 'microsoft']
	];
	return known.find(([k]) => l.includes(k))?.[1] ?? null;
}
