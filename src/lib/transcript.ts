/**
 * Reads Claude Code's JSONL transcripts for the overview: last prompt, last reply, last
 * tool, task list and title. The format is internal to Claude Code and changes between
 * versions, so everything here is best effort: unknown lines are skipped, never fatal.
 */
import type { ReadPart, ReadTurn, Todo, TranscriptSummary } from './types.ts';

type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
type Entry = {
	type?: string;
	isMeta?: boolean;
	isSidechain?: boolean;
	timestamp?: string;
	message?: { role?: string; content?: string | Block[] };
	customTitle?: string;
	aiTitle?: string;
	title?: string;
	summary?: string;
};

function parseLines(text: string): Entry[] {
	const out: Entry[] = [];
	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		try {
			const v = JSON.parse(line);
			if (v && typeof v === 'object') out.push(v as Entry);
		} catch {
			// A partial last line while Claude is writing, or a format we don't know.
		}
	}
	return out;
}

/** The text someone typed, or null for tool results, slash-command echoes and system notes. */
function promptText(e: Entry): string | null {
	if (e.type !== 'user' || e.isMeta || e.isSidechain) return null;
	const c = e.message?.content;
	const raw = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n') : '';
	const t = raw.trim();
	if (!t || /^<(?:command-|local-command-|system-reminder|bash-|user-memory)/.test(t) || t.startsWith('Caveat:')) return null;
	if (t.startsWith('[Request interrupted')) return null;
	return t.replace(/<[^>]+>/g, '').trim() || null;
}

function replyText(e: Entry): string | null {
	if (e.type !== 'assistant' || e.isSidechain) return null;
	const c = e.message?.content;
	if (!Array.isArray(c)) return typeof c === 'string' && c.trim() ? c.trim() : null;
	const t = c
		.filter((b) => b?.type === 'text')
		.map((b) => b.text ?? '')
		.join('\n')
		.trim();
	return t || null;
}

/** "Bash: npm test", "Edit: src/app.ts" — the tool and what it touched. */
export function describeTool(b: Block): string {
	const i = b.input ?? {};
	const pick = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
	const detail = pick('command') || pick('file_path') || pick('path') || pick('pattern') || pick('url') || pick('description') || pick('subject');
	const short = detail.split('\n')[0].slice(0, 120);
	return short ? `${b.name}: ${short}` : (b.name ?? 'tool');
}

function toolUses(e: Entry): Block[] {
	if (e.type !== 'assistant' || e.isSidechain) return [];
	const c = e.message?.content;
	return Array.isArray(c) ? c.filter((b) => b?.type === 'tool_use' && typeof b.name === 'string') : [];
}

const STATUSES = new Set(['pending', 'in_progress', 'completed']);

/** Replays TodoWrite (older Claude Code) and TaskCreate/TaskUpdate (newer) into one list. */
function applyTodos(todos: Map<string, Todo>, b: Block, counter: { n: number }) {
	const i = b.input ?? {};
	if (b.name === 'TodoWrite' && Array.isArray(i.todos)) {
		todos.clear();
		for (const t of i.todos as { content?: string; status?: string }[]) {
			if (typeof t?.content !== 'string') continue;
			todos.set(String(++counter.n), { content: t.content, status: STATUSES.has(t.status ?? '') ? (t.status as Todo['status']) : 'pending' });
		}
	} else if (b.name === 'TaskCreate' && typeof i.subject === 'string') {
		todos.set(String(++counter.n), { content: i.subject, status: 'pending' });
	} else if (b.name === 'TaskUpdate' && i.taskId !== undefined) {
		const id = String(i.taskId);
		const t = todos.get(id);
		if (!t) return;
		if (i.status === 'deleted') todos.delete(id);
		else if (STATUSES.has(i.status as string)) t.status = i.status as Todo['status'];
		if (typeof i.subject === 'string') t.content = i.subject;
	}
}

function titleOf(entries: Entry[]): string | null {
	let custom: string | null = null;
	let generated: string | null = null;
	for (const e of entries) {
		if (typeof e.customTitle === 'string' && e.customTitle.trim()) custom = e.customTitle.trim();
		else if (typeof e.aiTitle === 'string' && e.aiTitle.trim()) generated = e.aiTitle.trim();
		else if (e.type?.includes('title') && typeof e.title === 'string' && e.title.trim()) generated = e.title.trim();
		else if (e.type === 'summary' && typeof e.summary === 'string' && e.summary.trim()) generated ??= e.summary.trim();
	}
	return custom ?? generated;
}

const clip = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function summarizeTranscript(text: string, conversationId: string, updatedAt: string): TranscriptSummary {
	const entries = parseLines(text);
	let lastPrompt: string | null = null;
	let lastReply: string | null = null;
	let lastTool: string | null = null;
	let messages = 0;
	const todos = new Map<string, Todo>();
	const counter = { n: 0 };
	for (const e of entries) {
		const p = promptText(e);
		if (p) {
			lastPrompt = p;
			messages++;
		}
		const r = replyText(e);
		if (r) {
			lastReply = r;
			messages++;
		}
		for (const b of toolUses(e)) {
			lastTool = describeTool(b);
			applyTodos(todos, b, counter);
		}
	}
	return {
		conversationId,
		title: titleOf(entries),
		lastPrompt: clip(lastPrompt, 600),
		lastReply: clip(lastReply, 900),
		lastTool,
		messages,
		updatedAt,
		todos: [...todos.values()]
	};
}

/** Title, first prompt and message count, for the "resume a conversation" list. */
export function conversationInfo(text: string): { title: string | null; firstPrompt: string | null; messages: number } {
	const entries = parseLines(text);
	let firstPrompt: string | null = null;
	let messages = 0;
	for (const e of entries) {
		const p = promptText(e);
		if (p) {
			firstPrompt ??= p;
			messages++;
		} else if (replyText(e)) messages++;
	}
	return { title: titleOf(entries), firstPrompt: clip(firstPrompt, 200), messages };
}

/** A plain-text excerpt of the conversation's recent turns, for an AI summary. */
export function excerpt(text: string, maxChars = 60_000): string {
	const parts: string[] = [];
	for (const e of parseLines(text)) {
		const p = promptText(e);
		if (p) parts.push(`USER: ${clip(p, 2000)}`);
		const r = replyText(e);
		if (r) parts.push(`CLAUDE: ${clip(r, 2000)}`);
		for (const b of toolUses(e)) parts.push(`TOOL ${describeTool(b)}`);
	}
	const out: string[] = [];
	let size = 0;
	for (let i = parts.length - 1; i >= 0 && size < maxChars; i--) {
		out.unshift(parts[i]);
		size += parts[i].length + 1;
	}
	return out.join('\n');
}

/**
 * The conversation as turns, for reading: each prompt you sent, then the agent's words and the
 * tools it ran in between, in order. The newest `max` turns.
 */
export function readTurns(text: string, max = 100): ReadTurn[] {
	const turns: ReadTurn[] = [];
	let cur: ReadTurn | null = null;
	const start = (prompt: string | null, at: string | null) => {
		cur = { prompt, at, parts: [] };
		turns.push(cur);
		return cur;
	};
	for (const e of parseLines(text)) {
		const p = promptText(e);
		if (p) {
			start(p, typeof e.timestamp === 'string' ? e.timestamp : null);
			continue;
		}
		if (e.type !== 'assistant' || e.isSidechain) continue;
		const c = e.message?.content;
		const blocks: Block[] = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
		for (const b of blocks) {
			const t: ReadTurn = cur ?? start(null, null);
			const last: ReadPart | undefined = t.parts.at(-1);
			if (b?.type === 'text' && b.text?.trim()) {
				if (last?.kind === 'text') last.text += `\n\n${b.text.trim()}`;
				else t.parts.push({ kind: 'text', text: b.text.trim() });
			} else if (b?.type === 'tool_use' && typeof b.name === 'string') {
				if (last?.kind === 'tools') last.tools.push(describeTool(b));
				else t.parts.push({ kind: 'tools', tools: [describeTool(b)] });
			}
		}
	}
	return turns.filter((t) => t.prompt || t.parts.length).slice(-max);
}
