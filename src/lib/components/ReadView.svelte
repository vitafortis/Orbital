<script lang="ts">
	import { ChevronRight, LoaderCircle, Send, Wrench } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { ago } from '#lib/client/format.ts';
	import { renderMarkdown } from '#lib/client/markdown.ts';
	import { sendToSession } from '#lib/client/sessions.ts';
	import { classify, isActionHeading } from '#lib/highlight.ts';
	import type { ReadConversation, Session } from '#lib/types.ts';

	/**
	 * The conversation as formatted pages, from Claude Code's transcript: easier to read than the
	 * terminal, on a phone above all. Headings fold, long replies get an outline, what's addressed
	 * to you is coloured as in the terminal, and list items can be ticked off.
	 */
	let {
		session: s,
		updatedAt,
		running,
		agentName
	}: { session: Pick<Session, 'id'>; updatedAt?: string; running: boolean; agentName: string } = $props();

	let data = $state<ReadConversation | null>(null);
	let loaded = $state(false);
	let error = $state('');
	let ticked = $state(new Set<string>());
	let opened = $state(new Set<number>());
	let scroller = $state<HTMLDivElement>();

	async function load() {
		try {
			const first = !loaded;
			data = await api.get<ReadConversation | null>(`/api/sessions/${s.id}/read`);
			ticked = new Set(data?.ticked ?? []);
			error = '';
			loaded = true;
			// Open at the newest turn, from its start.
			if (first) requestAnimationFrame(() => scroller?.querySelector('[data-turn]:last-of-type')?.scrollIntoView({ block: 'start' }));
		} catch (err) {
			error = errorMessage(err);
			loaded = true;
		}
	}
	// Again whenever the conversation moves on.
	$effect(() => {
		void updatedAt;
		void load();
	});

	const last = $derived((data?.turns.length ?? 0) - 1);
	const isOpen = (i: number) => i === last || opened.has(i);
	function toggleTurn(i: number) {
		const next = new Set(opened);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		opened = next;
	}

	/** A short, stable key for a list item: which conversation, and its text. */
	function itemKey(text: string) {
		let h = 0x811c9dc5;
		for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
		return `${data?.conversationId.slice(0, 8)}:${(h >>> 0).toString(36)}`;
	}

	async function tick(key: string, done: boolean, li: HTMLElement) {
		li.classList.toggle('ticked', done);
		const next = new Set(ticked);
		if (done) next.add(key);
		else next.delete(key);
		ticked = next;
		try {
			await api.post(`/api/sessions/${s.id}/read`, { key, done });
		} catch (err) {
			li.classList.toggle('ticked', !done);
			error = errorMessage(err);
		}
	}

	/** An element's own text, without its nested lists. */
	function ownText(el: Element): string {
		let t = '';
		for (const n of el.childNodes) if (!(n instanceof HTMLElement && (n.tagName === 'UL' || n.tagName === 'OL'))) t += n.textContent ?? '';
		return t.trim();
	}

	/**
	 * Colours, ticks, folding headings and an outline, over a reply's rendered Markdown. Once per
	 * render of it ({#key}): untracked, so ticking something doesn't run it again.
	 */
	function enhance(root: HTMLElement) {
		untrack(() => enhanceNow(root));
	}
	function enhanceNow(root: HTMLElement) {
		for (const el of root.querySelectorAll('p, li')) {
			if (el.tagName === 'P' && el.parentElement?.tagName === 'LI') continue;
			const text = ownText(el);
			const intro = el.tagName === 'LI' ? el.parentElement?.previousElementSibling : null;
			const kind = classify(text) ?? (intro && isActionHeading(intro.textContent ?? '') ? 'action' : null);
			if (kind) el.classList.add('hl', `hl-${kind}`);
		}
		for (const li of root.querySelectorAll<HTMLElement>('ul > li')) {
			const key = itemKey(ownText(li));
			const box = document.createElement('button');
			box.type = 'button';
			box.className = 'tick';
			box.setAttribute('aria-label', 'Tick off');
			box.onclick = () => tick(key, !li.classList.contains('ticked'), li);
			li.prepend(box);
			li.classList.toggle('ticked', ticked.has(key));
		}
		const headings = [...root.querySelectorAll<HTMLElement>(':scope > h1, :scope > h2, :scope > h3')];
		for (const h of headings) {
			const level = Number(h.tagName[1]);
			const body: Element[] = [];
			for (let n = h.nextElementSibling; n && !(/^H[1-3]$/.test(n.tagName) && Number(n.tagName[1]) <= level); n = n.nextElementSibling) body.push(n);
			if (!body.length) continue;
			h.classList.add('fold');
			h.tabIndex = 0;
			h.setAttribute('role', 'button');
			h.setAttribute('aria-expanded', 'true');
			const toggle = () => {
				const open = h.getAttribute('aria-expanded') !== 'true';
				h.setAttribute('aria-expanded', String(open));
				for (const b of body) (b as HTMLElement).hidden = !open;
			};
			h.onclick = toggle;
			h.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle());
		}
		if (headings.length >= 3) {
			const nav = document.createElement('nav');
			nav.className = 'toc';
			for (const h of headings) {
				const a = document.createElement('button');
				a.type = 'button';
				a.textContent = h.textContent;
				a.onclick = () => h.scrollIntoView({ behavior: 'smooth', block: 'start' });
				nav.append(a);
			}
			root.prepend(nav);
		}
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

<div class="flex min-h-0 flex-1 flex-col bg-background">
	<div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-3xl space-y-3 px-4 py-4 sm:px-6">
			{#if !loaded}
				<p class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading the conversation…</p>
			{:else if !data?.turns.length}
				<p class="text-sm text-muted-foreground">{error || `Nothing to read yet. Once you talk to ${agentName}, the conversation shows here, formatted.`}</p>
			{:else}
				{#if error}<p class="text-xs text-danger">{error}</p>{/if}
				{#each data.turns as turn, i (i)}
					<article data-turn class="scroll-mt-3">
						{#if turn.prompt}
							<button type="button" class="flex w-full items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left" aria-expanded={isOpen(i)} onclick={() => i !== last && toggleTurn(i)}>
								{#if i !== last}<ChevronRight class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform {isOpen(i) ? 'rotate-90' : ''}" />{/if}
								<span class="min-w-0 flex-1">
									<span class="block text-[0.6875rem] font-medium text-muted-foreground">You{#if turn.at} · {ago(turn.at)}{/if}</span>
									<span class="block text-[0.8125rem] whitespace-pre-wrap {isOpen(i) ? 'line-clamp-6' : 'line-clamp-1'}">{turn.prompt}</span>
								</span>
							</button>
						{/if}
						{#if isOpen(i) || !turn.prompt}
							<div class="mt-2 space-y-2">
								{#each turn.parts as part, j (j)}
									{#if part.kind === 'text'}
										{@const html = renderMarkdown(part.text)}
										{#key html}
											<div class="read-md" {@attach enhance}>{@html html}</div>
										{/key}
									{:else}
										<details class="group rounded-lg text-xs text-muted-foreground">
											<summary class="flex cursor-pointer list-none items-center gap-1.5 py-0.5 hover:text-foreground">
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
						{/if}
					</article>
				{/each}
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
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.read-md :global(> * + *) {
		margin-top: 0.6em;
	}
	.read-md :global(h1),
	.read-md :global(h2),
	.read-md :global(h3),
	.read-md :global(h4) {
		font-weight: 600;
		letter-spacing: -0.01em;
		margin-top: 1.1em;
	}
	.read-md :global(h1) {
		font-size: 1.125rem;
	}
	.read-md :global(h2) {
		font-size: 1rem;
	}
	.read-md :global(h3),
	.read-md :global(h4) {
		font-size: 0.9375rem;
	}
	.read-md :global(.fold) {
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
	.read-md :global(.fold)::before {
		content: '';
		width: 0.4em;
		height: 0.4em;
		border-right: 1.5px solid currentColor;
		border-bottom: 1.5px solid currentColor;
		transform: rotate(45deg);
		opacity: 0.5;
		transition: transform 0.15s;
		flex-shrink: 0;
	}
	.read-md :global(.fold[aria-expanded='false'])::before {
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
	.read-md :global(ul),
	.read-md :global(ol) {
		padding-left: 1.25rem;
	}
	.read-md :global(ol) {
		list-style: decimal;
	}
	.read-md :global(ul) {
		list-style: none;
		padding-left: 0.25rem;
	}
	.read-md :global(li) {
		margin-top: 0.25em;
	}
	.read-md :global(ul > li) {
		position: relative;
		padding-left: 1.4rem;
	}
	.read-md :global(li > ul),
	.read-md :global(li > ol) {
		margin-top: 0.25em;
	}
	/* The bullet is the tick box. */
	.read-md :global(.tick) {
		position: absolute;
		left: 0.15rem;
		top: 0.42em;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 999px;
		border: 1.5px solid color-mix(in oklch, currentColor 35%, transparent);
		display: grid;
		place-items: center;
	}
	.read-md :global(.tick:hover) {
		border-color: var(--success);
	}
	.read-md :global(li.ticked > .tick) {
		background: var(--success);
		border-color: var(--success);
	}
	.read-md :global(li.ticked > .tick)::after {
		content: '';
		width: 0.25rem;
		height: 0.45rem;
		border-right: 1.5px solid white;
		border-bottom: 1.5px solid white;
		transform: translateY(-1px) rotate(45deg);
	}
	.read-md :global(li.ticked) {
		color: var(--muted-foreground);
		text-decoration: line-through;
		text-decoration-color: color-mix(in oklch, currentColor 50%, transparent);
	}
	/* What's addressed to you, coloured as in the terminal. */
	.read-md :global(.hl) {
		border-left: 2px solid var(--hl);
		background: color-mix(in oklch, var(--hl) 9%, transparent);
		border-radius: 0 0.375rem 0.375rem 0;
		padding: 0.15em 0.5em;
		margin-left: -0.6rem;
		padding-left: calc(0.6rem - 2px);
	}
	.read-md :global(ul > li.hl) {
		padding-left: calc(0.6rem + 1.4rem - 2px);
	}
	.read-md :global(ul > li.hl > .tick) {
		left: calc(0.6rem + 0.15rem - 2px);
		top: calc(0.42em + 0.15em);
	}
	.read-md :global(.hl-question) {
		--hl: var(--warning);
	}
	.read-md :global(.hl-urgent) {
		--hl: var(--danger);
	}
	.read-md :global(.hl-action) {
		--hl: var(--primary);
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
	.read-md :global(.toc) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-bottom: 0.25rem;
	}
	.read-md :global(.toc button) {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.1rem 0.6rem;
		font-size: 0.75rem;
		color: var(--muted-foreground);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.read-md :global(.toc button:hover) {
		color: var(--foreground);
		border-color: var(--primary);
	}
</style>
