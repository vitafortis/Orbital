/**
 * Finds what's addressed to you on the agent's screen, so the terminal can colour it: questions
 * it asks, things that are urgent, and things it says you need to do. Plain text heuristics over
 * the visible rows; the screen is Claude Code's own drawing and changes between versions, so
 * anything unclear is left alone rather than guessed at. (Bold text, headings and labels like
 * "Security:", is coloured by the terminal itself, which knows which cells are bold.)
 */

export type HighlightKind = 'question' | 'urgent' | 'action';
/** Rows `from` to `to` (inclusive) of the screen. */
export type Highlight = { kind: HighlightKind; from: number; to: number };

// Rows that start a block of their own: a reply or tool call (⏺), tool output (⎿), list items.
const STARTS_BLOCK = /^\s*(?:[⏺●⎿]|[-*•]\s|\d+[.)]\s|[☐☒◻◼✔✓]\s?)/;
const LIST_ITEM = /^\s*(?:[-*•]\s|\d+[.)]\s)/;
// Never ours to colour: your prompts, the input box and its rules, tool output, boxes, the
// spinner and "Worked for…" lines, and hints drawn at the right ("new task? /clear to save…").
const SKIP = /^\s*(?:[>❯›⎿│┃╭╰├└─━═※✻✶✳✢✽]|\?\s)|^\s{20,}/;
const TOOL_CALL = /^\s*[⏺●]\s*[A-Z][\w-]*(?:\(|$)/;

// "…want me to open a PR?": a question mark after a word, not in code or a URL.
const QUESTION = /[\p{L}\p{N})\]'"’”*_]\?(?=\s|$|[)"'’”*_])/u;
const DAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|eod|end of (?:the )?(?:day|week))';
const URGENT = new RegExp(
	`\\b(?:urgent(?:ly)?|asap|blockers?|blocking|critical|immediately|right away|data loss|security (?:hole|risk|issue)|(?:is|are) (?:broken|down)|before ${DAY}|by ${DAY})\\b`,
	'i'
);
const ACTION =
	/^(?:you(?:'ll|’ll| will)? (?:need|have|want|must|should)\b|you can now\b|please\b|make sure\b|don't forget\b|don’t forget\b|remember to\b|before (?:you|merging|deploying)\b|action (?:required|needed)\b|to ?do:|next steps?\b|manual steps?\b)/i;
const ACTION_HEADING =
	/(?:next steps?|to ?dos?|action items?|you(?:'ll|’ll| will)? (?:need|have) to|before (?:you|merging|deploying)|follow[- ]ups?|manual steps?|what you need to do|for you to do)\b[^:]*:\s*\**$/i;

type Block = { from: number; to: number; text: string; list: boolean };

/** Splits the screen into blocks: paragraphs and list items, each with its wrapped rows. */
function blocks(lines: string[]): Block[] {
	const out: Block[] = [];
	let cur: Block | null = null;
	lines.forEach((line, y) => {
		if (!line.trim()) {
			cur = null;
			return;
		}
		if (!cur || STARTS_BLOCK.test(line) || SKIP.test(line)) {
			cur = { from: y, to: y, text: line, list: LIST_ITEM.test(line) };
			out.push(cur);
		} else {
			cur.to = y;
			cur.text += ` ${line.trim()}`;
		}
	});
	return out;
}

/** Strips the reply marker and list bullet, and inline code, which often holds a stray "?". */
const prose = (text: string) =>
	text
		.trim()
		.replace(/^[⏺●]\s*/, '')
		.replace(/^(?:[-*•]|\d+[.)])\s+/, '')
		.replace(/`[^`]*`/g, '`…`')
		.replace(/\bhttps?:\/\/\S+/g, 'url')
		.replace(/^\*\*(.*?)\*\*/, '$1');

const sentences = (text: string) => text.split(/(?<=[.!:;])\s+/);

/** Rows that are the agent's tools or the agent's chrome rather than its words: never coloured. */
export const isChrome = (line: string) => SKIP.test(line) || TOOL_CALL.test(line);

/** A heading that introduces things for you to do ("Next steps:"); its list items are actions too. */
export const isActionHeading = (text: string) => ACTION_HEADING.test(prose(text));

/** What one paragraph or list item is, if it's addressed to you. */
export function classify(text: string): HighlightKind | null {
	const t = prose(text);
	if (QUESTION.test(t)) return 'question';
	if (URGENT.test(t)) return 'urgent';
	if (ACTION_HEADING.test(t) || sentences(t).some((x) => ACTION.test(x))) return 'action';
	return null;
}

/** The rows to colour on a screen of plain-text rows, top to bottom. */
export function findHighlights(lines: string[]): Highlight[] {
	const out: Highlight[] = [];
	// After a heading like "Next steps:", its list items are actions too, up to the next prose.
	let underHeading = false;
	for (const b of blocks(lines)) {
		if (isChrome(b.text)) {
			underHeading = false;
			continue;
		}
		if (!b.list) underHeading = false;
		const kind = classify(b.text) ?? (underHeading && b.list ? 'action' : null);
		if (kind) out.push({ kind, from: b.from, to: b.to });
		if (kind === 'action' && isActionHeading(b.text)) underHeading = true;
	}
	return out;
}
