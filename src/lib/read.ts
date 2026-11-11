import type { ReadTurn } from './types.ts';

/** Markdown as one line of plain text: no code, links' text only, no emphasis or list marks. */
export function plainLine(md: string): string {
	return md
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/gm, '')
		.replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2')
		.replace(/\|/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * A turn in one line, for the folded history: the first sentence of its last reply, where the
 * reply style puts the outcome. Null when the agent said nothing (only ran tools).
 */
export function turnOutcome(turn: ReadTurn, max = 160): string | null {
	const last = [...turn.parts].reverse().find((p) => p.kind === 'text');
	if (!last || last.kind !== 'text') return null;
	// The first paragraph that says something: not a heading or a code block.
	const block = last.text.split(/\n\s*\n/).find((b) => b.trim() && !/^\s{0,3}(?:#{1,6}\s|```)/.test(b));
	const text = plainLine(block ?? last.text);
	if (!text) return null;
	const sentence = /^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text;
	return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** Whether a turn mentions every word of a search, in your prompt or its replies. */
export function turnMatches(turn: ReadTurn, query: string): boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return true;
	const hay = [turn.prompt ?? '', ...turn.parts.map((p) => (p.kind === 'text' ? p.text : p.tools.join(' ')))].join('\n').toLowerCase();
	return words.every((w) => hay.includes(w));
}
