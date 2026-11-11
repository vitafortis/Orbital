<script lang="ts">
	import { ChevronRight, CircleHelp, LoaderCircle, Search, Send, Wrench, X } from '@lucide/svelte';
	import { onDestroy, tick, untrack } from 'svelte';
	import TodoList from './TodoList.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { ago, plural } from '#lib/client/format.ts';
	import { renderMarkdown } from '#lib/client/markdown.ts';
	import { sendToSession } from '#lib/client/sessions.ts';
	import { tellByDefault } from '#lib/client/todos.ts';
	import { classify } from '#lib/highlight.ts';
	import { turnMatches, turnOutcome } from '#lib/read.ts';
	import type { ReadConversation, ReadTurn, Session, TodoItem } from '#lib/types.ts';

	/**
	 * The conversation as formatted pages, from Claude Code's transcript, kept calm: the latest
	 * turn in full; earlier ones folded to your prompt and their outcome (the first sentence of the
	 * reply, which the Library's reply style asks for), with what's new since you last looked.
	 * Questions to you and urgent things are marked; what you have to do is the To do list on top.
	 */
	let {
		session: s,
		updatedAt,
		running,
		agentName,
		todos = []
	}: { session: Pick<Session, 'id'>; updatedAt?: string; running: boolean; agentName: string; todos?: TodoItem[] } = $props();

	let data = $state<ReadConversation | null>(null);
	let loaded = $state(false);
	let error = $state('');
	let scroller = $state<HTMLDivElement>();

	// Turns seen when you last left this conversation; later ones are new.
	const seenKey = (id: string) => `orb.read.seen.${id}`;
	let seenBefore = $state<number | null>(null);
	function rememberSeen() {
		if (!data) return;
		try {
			localStorage.setItem(seenKey(data.conversationId), String(data.turns.length));
		} catch {}
	}
	onDestroy(rememberSeen);
	$effect(() => {
		const hide = () => document.visibilityState === 'hidden' && rememberSeen();
		document.addEventListener('visibilitychange', hide);
		return () => document.removeEventListener('visibilitychange', hide);
	});

	async function load() {
		try {
			const first = !loaded;
			data = await api.get<ReadConversation | null>(`/api/sessions/${s.id}/read`);
			error = '';
			loaded = true;
			if (first && data) {
				try {
					const v = localStorage.getItem(seenKey(data.conversationId));
					seenBefore = v === null ? null : Number(v);
				} catch {}
				// Open at the latest turn, from its start.
				requestAnimationFrame(() => scroller?.querySelector('[data-latest]')?.scrollIntoView({ block: 'start' }));
			}
		} catch (err) {
			error = errorMessage(err);
			loaded = true;
		}
	}
	// Again whenever the conversation moves on.
	$effect(() => {
		void updatedAt;
		untrack(() => void load());
	});

	const turns = $derived(data?.turns ?? []);
	const latest = $derived(turns.at(-1) ?? null);
	const earlier = $derived(turns.slice(0, -1));
	const isNew = (i: number) => seenBefore !== null && i >= seenBefore;
	const newCount = $derived(seenBefore === null ? 0 : Math.max(0, turns.length - seenBefore));

	// The history: the last few rows, unless you ask for all of them.
	const RECENT = 6;
	let allEarlier = $state(false);
	const shownEarlier = $derived((allEarlier ? earlier : earlier.slice(-RECENT)).map((t) => ({ t, i: earlier.indexOf(t) })));
	let opened = $state(new Set<number>());
	function toggle(i: number) {
		const next = new Set(opened);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		opened = next;
	}

	let query = $state('');
	const results = $derived(query.trim() ? turns.map((t, i) => ({ t, i })).filter(({ t }) => turnMatches(t, query)) : []);

	// Tool calls stay out of the way unless asked for; this browser remembers.
	let showTools = $state(false);
	$effect(() => {
		try {
			showTools = localStorage.getItem('orb.read.tools') === '1';
		} catch {}
	});
	function setTools(on: boolean) {
		showTools = on;
		try {
			localStorage.setItem('orb.read.tools', on ? '1' : '0');
		} catch {}
	}

	// Questions in the latest reply, counted once it's on the page.
	let questions = $state(0);
	let latestEl = $state<HTMLElement>();
	$effect(() => {
		void latest;
		void latestEl;
		void tick().then(() => (questions = latestEl?.querySelectorAll('.hl-question').length ?? 0));
	});
	const needsYou = $derived(questions + todos.length);
	function jumpToNeeds() {
		const target = scroller?.querySelector(todos.length ? '[data-todos]' : '[data-latest] .hl-question');
		target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	/** An element's own text, without its nested lists. */
	function ownText(el: Element): string {
		let t = '';
		for (const n of el.childNodes) if (!(n instanceof HTMLElement && (n.tagName === 'UL' || n.tagName === 'OL'))) t += n.textContent ?? '';
		return t.trim();
	}

	/**
	 * Marks questions and urgent things in a reply's rendered Markdown, and lets its headings fold.
	 * Once per render of it ({#key}).
	 */
	function enhance(root: HTMLElement) {
		untrack(() => {
			for (const el of root.querySelectorAll('p, li')) {
				if (el.tagName === 'P' && el.parentElement?.tagName === 'LI') continue;
				const kind = classify(ownText(el));
				if (kind === 'question' || kind === 'urgent') el.classList.add('hl', `hl-${kind}`);
			}
			for (const h of root.querySelectorAll<HTMLElement>(':scope > h1, :scope > h2, :scope > h3')) {
				const level = Number(h.tagName[1]);
				const body: HTMLElement[] = [];
				for (let n = h.nextElementSibling; n && !(/^H[1-3]$/.test(n.tagName) && Number(n.tagName[1]) <= level); n = n.nextElementSibling) body.push(n as HTMLElement);
				if (!body.length) continue;
				h.classList.add('fold');
				h.tabIndex = 0;
				h.setAttribute('role', 'button');
				h.setAttribute('aria-expanded', 'true');
				const fold = () => {
					const open = h.getAttribute('aria-expanded') !== 'true';
					h.setAttribute('aria-expanded', String(open));
					for (const b of body) b.hidden = !open;
				};
				h.onclick = fold;
				h.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fold());
			}
		});
	}

	let reply = $state('');
	let sending = $state(false);
	async function send(e: SubmitEvent) {
		e.preventDefault();
		if (!reply.trim() || sending) return;
		sending = true;
		if (await sendToSession(s, { text: reply, enter: true })) reply = '';
		sending = false;
	}
</script>

{#snippet prompt(turn: ReadTurn)}
	{#if turn.prompt}
		<div class="rounded-xl border border-border bg-surface px-3 py-2">
			<p class="text-[0.6875rem] font-medium text-muted-foreground">You{#if turn.at} · {ago(turn.at)}{/if}</p>
			<p class="line-clamp-6 text-[0.8125rem] whitespace-pre-wrap">{turn.prompt}</p>
		</div>
	{/if}
{/snippet}

{#snippet body(turn: ReadTurn)}
	<div class="mt-2 space-y-3">
		{#each turn.parts as part, j (j)}
			{#if part.kind === 'text'}
				{@const html = renderMarkdown(part.text)}
				{#key html}
					<div class="read-md" {@attach enhance}>{@html html}</div>
				{/key}
			{:else if showTools}
				<details class="group text-xs text-muted-foreground">
					<summary class="flex cursor-pointer list-none items-center gap-1.5 hover:text-foreground">
						<Wrench class="size-3.5" />Ran {part.tools.length === 1 ? part.tools[0] : `${part.tools.length} tools`}
						{#if part.tools.length > 1}<ChevronRight class="size-3.5 transition-transform group-open:rotate-90" />{/if}
					</summary>
					{#if part.tools.length > 1}
						<ul class="mt-1 space-y-0.5 border-l border-border pl-3 font-mono text-[0.6875rem]">
							{#each part.tools as t, k (k)}<li class="truncate" title={t}>{t}</li>{/each}
						</ul>
					{/if}
				</details>
			{/if}
		{/each}
	</div>
{/snippet}

{#snippet row(turn: ReadTurn, i: number)}
	{@const outcome = turnOutcome(turn)}
	<li>
		<button type="button" class="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent/60" aria-expanded={opened.has(i)} onclick={() => toggle(i)}>
			<ChevronRight class="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform {opened.has(i) ? 'rotate-90' : ''}" />
			<span class="min-w-0 flex-1">
				<span class="flex items-center gap-1.5">
					{#if isNew(i)}<span class="size-1.5 shrink-0 rounded-full bg-primary" title="New since you last looked"></span>{/if}
					<span class="truncate text-[0.8125rem] font-medium">{turn.prompt ?? 'The agent carried on'}</span>
				</span>
				{#if outcome}<span class="block truncate text-xs text-muted-foreground">{outcome}</span>{/if}
			</span>
			{#if turn.at}<span class="shrink-0 text-[0.6875rem] text-muted-foreground">{ago(turn.at)}</span>{/if}
		</button>
		{#if opened.has(i)}
			<div class="mb-3 ml-7 border-l border-border pl-3">{@render body(turn)}</div>
		{/if}
	</li>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col bg-background">
	{#if turns.length}
		<div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 sm:px-4">
			<label class="relative min-w-0 flex-1">
				<Search class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<input class="input h-8 pl-8 text-xs" placeholder="Search this conversation" aria-label="Search this conversation" bind:value={query} />
				{#if query}<button type="button" class="absolute top-1/2 right-1.5 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground" aria-label="Clear" onclick={() => (query = '')}><X class="size-3.5" /></button>{/if}
			</label>
			{#if needsYou}
				<button type="button" class="badge badge-warning shrink-0" onclick={jumpToNeeds}><CircleHelp />Needs you · {needsYou}</button>
			{/if}
			<button type="button" class="btn btn-ghost btn-sm shrink-0 {showTools ? 'text-foreground' : 'text-muted-foreground'}" aria-pressed={showTools} title={showTools ? 'Hide the tools the agent ran' : 'Show the tools the agent ran'} onclick={() => setTools(!showTools)}><Wrench /><span class="max-sm:hidden">Tools</span></button>
		</div>
	{/if}

	<div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-3xl space-y-5 px-4 py-4 sm:px-6">
			{#if !loaded}
				<p class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading the conversation…</p>
			{:else if !latest}
				<p class="text-sm text-muted-foreground">{error || `Nothing to read yet. Once you talk to ${agentName}, the conversation shows here, formatted.`}</p>
			{:else if query.trim()}
				<section>
					<p class="mb-1 px-2 text-xs text-muted-foreground">{results.length ? plural(results.length, 'turn') : 'No turns'} mention “{query.trim()}”</p>
					<ul>{#each results as r (r.i)}{@render row(r.t, r.i)}{/each}</ul>
				</section>
			{:else}
				{#if error}<p class="text-xs text-danger">{error}</p>{/if}

				{#if todos.length}
					<section data-todos class="rounded-xl border border-warning/40 bg-card p-3">
						<h2 class="mb-1.5 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/80 uppercase">For you · {todos.length}</h2>
						<TodoList items={todos} running={() => running} tell={tellByDefault()} compact />
					</section>
				{/if}

				{#if earlier.length}
					<section>
						<div class="mb-1 flex items-center justify-between px-2">
							<h2 class="text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/80 uppercase">
								Earlier · {plural(earlier.length, 'turn')}{#if newCount > 1} · <span class="text-primary normal-case">{newCount - 1} new</span>{/if}
							</h2>
							{#if earlier.length > RECENT}
								<button type="button" class="text-xs text-primary hover:underline" onclick={() => (allEarlier = !allEarlier)}>{allEarlier ? 'Fewer' : `All ${earlier.length}`}</button>
							{/if}
						</div>
						<ul>{#each shownEarlier as r (r.i)}{@render row(r.t, r.i)}{/each}</ul>
					</section>
				{/if}

				<article data-latest bind:this={latestEl} class="scroll-mt-3">
					{#if isNew(turns.length - 1)}<p class="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-medium text-primary"><span class="size-1.5 rounded-full bg-primary"></span>New since you last looked</p>{/if}
					{@render prompt(latest)}
					{@render body(latest)}
				</article>
			{/if}
		</div>
	</div>
	{#if running}
		<form class="flex shrink-0 gap-2 border-t border-border bg-surface px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" onsubmit={send}>
			<input class="input h-9" placeholder="Reply to {agentName}…" bind:value={reply} />
			<button class="btn btn-primary h-9" disabled={sending || !reply.trim()} title="Send"><Send /></button>
		</form>
	{/if}
</div>

<style>
	.read-md {
		font-size: 0.875rem;
		line-height: 1.65;
		overflow-wrap: anywhere;
	}
	.read-md :global(> * + *) {
		margin-top: 0.65em;
	}
	.read-md :global(h1),
	.read-md :global(h2),
	.read-md :global(h3),
	.read-md :global(h4) {
		font-weight: 600;
		letter-spacing: -0.01em;
		margin-top: 1.2em;
	}
	.read-md :global(h1) {
		font-size: 1.0625rem;
	}
	.read-md :global(h2) {
		font-size: 1rem;
	}
	.read-md :global(h3),
	.read-md :global(h4) {
		font-size: 0.9375rem;
	}
	/* Headings fold; the marker shows on hover, and when folded. */
	.read-md :global(.fold) {
		cursor: pointer;
		position: relative;
	}
	.read-md :global(.fold)::before {
		content: '';
		position: absolute;
		left: -0.9rem;
		top: 0.5em;
		width: 0.38em;
		height: 0.38em;
		border-right: 1.5px solid currentColor;
		border-bottom: 1.5px solid currentColor;
		transform: rotate(45deg);
		opacity: 0;
		transition:
			opacity 0.15s,
			transform 0.15s;
	}
	.read-md :global(.fold:hover)::before {
		opacity: 0.45;
	}
	.read-md :global(.fold[aria-expanded='false'])::before {
		opacity: 0.6;
		transform: rotate(-45deg);
	}
	.read-md :global(strong) {
		font-weight: 600;
	}
	.read-md :global(a) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.read-md :global(code) {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--muted);
		border-radius: 0.3rem;
		padding: 0.1em 0.3em;
	}
	.read-md :global(pre) {
		background: var(--term-bg);
		color: #e6e8ee;
		border-radius: 0.6rem;
		padding: 0.75rem;
		overflow-x: auto;
		font-size: 0.75rem;
		line-height: 1.5;
	}
	.read-md :global(pre code) {
		background: none;
		padding: 0;
		font-size: inherit;
	}
	.read-md :global(ul) {
		list-style: disc;
		padding-left: 1.25rem;
	}
	.read-md :global(ol) {
		list-style: decimal;
		padding-left: 1.25rem;
	}
	.read-md :global(li) {
		margin-top: 0.2em;
	}
	.read-md :global(li::marker) {
		color: var(--muted-foreground);
	}
	/* Questions to you and urgent things: an edge, nothing more. */
	.read-md :global(.hl) {
		box-shadow: inset 2px 0 0 var(--hl);
		padding-left: 0.6rem;
		margin-left: -0.6rem;
	}
	.read-md :global(li.hl) {
		margin-left: 0;
	}
	.read-md :global(.hl-question) {
		--hl: var(--warning);
	}
	.read-md :global(.hl-urgent) {
		--hl: var(--danger);
	}
	.read-md :global(table) {
		display: block;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}
	.read-md :global(th),
	.read-md :global(td) {
		border: 1px solid var(--border);
		padding: 0.3rem 0.6rem;
		text-align: left;
	}
	.read-md :global(th) {
		background: var(--surface);
		font-weight: 600;
	}
	.read-md :global(blockquote) {
		border-left: 2px solid var(--border);
		padding-left: 0.75rem;
		color: var(--muted-foreground);
	}
	.read-md :global(hr) {
		border-color: var(--border);
	}
</style>
