<script lang="ts">
	import { ArrowRight, ChevronDown, CircleAlert, GitBranch, ListTodo, LoaderCircle, Play, Send, Sparkles, CircleStop, Trash2, Wrench } from '@lucide/svelte';
	import { repoLabel } from '#lib/launch.ts';
	import StateBadge from './StateBadge.svelte';
	import BrandIcon from './BrandIcon.svelte';
	import SessionTags from './SessionTags.svelte';
	import StateDot from './StateDot.svelte';
	import QuestionBar from './QuestionBar.svelte';
	import { findQuestion } from '#lib/pane.ts';
	import { ago } from '#lib/client/format.ts';
	import { deleteSession, sendToSession, startSession, stopSession } from '#lib/client/sessions.ts';
	import Menu from './Menu.svelte';
	import { AGENT_LABEL } from '#lib/providers.ts';
	import { displayState, glowClass } from '#lib/session-state.ts';
	import type { Session, SessionLive } from '#lib/types.ts';

	let { session: s, live }: { session: Session; live?: SessionLive } = $props();

	const view = $derived(displayState(s, live));
	const sum = $derived(live?.summary ?? null);
	const git = $derived(live?.git ?? null);
	const branch = $derived(git?.branch ?? s.newBranch ?? s.baseBranch);
	const done = $derived(sum?.todos.filter((t) => t.status === 'completed').length ?? 0);
	const current = $derived(sum?.todos.find((t) => t.status === 'in_progress'));
	const running = $derived(s.status === 'running');
	const preview = $derived((live?.tail ?? []).filter((l) => l.trim()).slice(-7));
	const question = $derived(running && view === 'waiting' ? findQuestion(live?.tail ?? []) : null);

	let reply = $state('');
	let busy = $state(false);

	async function send(e: SubmitEvent) {
		e.preventDefault();
		if (!reply.trim()) return;
		busy = true;
		if (await sendToSession(s, { text: reply, enter: true })) reply = '';
		busy = false;
	}

	// End: stop (repo and conversations stay) or delete it outright; a failed session has nothing to stop.
	const endItems = $derived([
		...(running ? [{ label: 'Stop', hint: 'Keeps the repo and conversations', icon: CircleStop, onclick: () => act(() => stopSession(s)) }] : []),
		{ label: 'Delete session', hint: 'Its clone, home folder and conversations', icon: Trash2, danger: true, onclick: () => act(() => deleteSession(s, '')) }
	]);

	async function act(fn: () => Promise<void>) {
		busy = true;
		await fn();
		busy = false;
	}
</script>

<article class="card flex min-w-0 flex-col overflow-hidden border-transparent {glowClass(view)}">
	<header class="flex items-start gap-3 px-4 pt-4">
		<StateDot state={view} class="mt-1.5" />
		<div class="min-w-0 flex-1">
			<a href="/s/{s.id}" class="block truncate text-[0.9375rem] font-semibold tracking-tight hover:text-primary">{s.name}</a>
			<p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
				<span class="truncate">{repoLabel(s)}</span>
				{#if branch}<GitBranch class="size-3 shrink-0" /><span class="truncate font-mono text-[0.6875rem]">{branch}</span>{/if}
			</p>
			<div class="mt-1.5 empty:hidden"><SessionTags session={s} /></div>
		</div>
		<StateBadge state={view} />
	</header>

	<div class="flex-1 space-y-2.5 px-4 pt-3 pb-3 text-[0.8125rem]">
		{#if s.status === 'error' && s.error}
			<p class="flex gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger"><CircleAlert class="mt-0.5 size-3.5 shrink-0" /><span class="line-clamp-3 whitespace-pre-wrap">{s.error}</span></p>
		{/if}
		{#if live?.aiSummary}
			<p class="flex gap-2 text-foreground/90"><Sparkles class="mt-0.5 size-3.5 shrink-0 text-primary" /><span class="line-clamp-3">{live.aiSummary.text}</span></p>
		{:else if sum?.title && sum.title !== s.name}
			<p class="line-clamp-1 font-medium">{sum.title}</p>
		{/if}
		{#if sum?.lastPrompt}
			<p class="line-clamp-2 text-muted-foreground"><span class="font-medium text-foreground/80">You:</span> {sum.lastPrompt}</p>
		{/if}
		{#if sum?.lastReply}
			<p class="line-clamp-3 text-muted-foreground"><span class="font-medium text-primary">Claude:</span> {sum.lastReply}</p>
		{/if}
		{#if !sum && s.status !== 'error'}
			<p class="text-muted-foreground">{view === 'starting' ? 'Starting the container and cloning the repo…' : s.agent === 'claude' ? 'No conversation yet.' : `${AGENT_LABEL[s.agent]}: see the terminal for the conversation.`}</p>
		{/if}
		{#if sum?.todos.length}
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<ListTodo class="size-3.5 shrink-0" />
				<span class="tabular-nums">{done}/{sum.todos.length}</span>
				<span class="h-1 w-16 overflow-hidden rounded-full bg-muted"><span class="block h-full rounded-full bg-primary" style="width:{(done / sum.todos.length) * 100}%"></span></span>
				{#if current}<span class="truncate">{current.content}</span>{/if}
			</div>
		{/if}
		{#if sum?.lastTool && view === 'working'}
			<p class="flex items-center gap-2 truncate font-mono text-[0.6875rem] text-muted-foreground"><Wrench class="size-3 shrink-0" /><span class="truncate">{sum.lastTool}</span></p>
		{/if}
	</div>

	{#if running && preview.length}
		<a href="/s/{s.id}" class="mx-4 mb-3 block overflow-hidden rounded-lg border border-term-edge px-3 py-2" style="background: var(--term-bg)" title="Open the terminal">
			<pre class="h-[7.5rem] overflow-hidden font-mono text-[0.625rem] leading-[1.05rem] text-[#c9cfda]">{preview.join('\n')}</pre>
		</a>
	{/if}

	{#if question}
		<QuestionBar card {question} agentName={AGENT_LABEL[s.agent]} onanswer={(n) => act(async () => void (await sendToSession(s, { keys: [String(n)] })))} oncancel={() => act(async () => void (await sendToSession(s, { keys: ['Escape'] })))} />
	{:else if running && view === 'waiting'}
		<form class="mx-4 mb-3 flex gap-2" onsubmit={send}>
			<input class="input h-8 text-xs" placeholder="Reply to Claude…" bind:value={reply} />
			<button class="btn btn-secondary btn-sm h-8" disabled={busy} title="Send"><Send /></button>
			<button type="button" class="btn btn-ghost btn-sm h-8 font-mono" disabled={busy} title="Choose option 1" onclick={() => sendToSession(s, { keys: ['1'] })}>1</button>
			<button type="button" class="btn btn-ghost btn-sm h-8" disabled={busy} title="Escape" onclick={() => sendToSession(s, { keys: ['Escape'] })}>Esc</button>
		</form>
	{/if}

	<footer class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-surface/60 px-4 py-2.5 text-xs text-muted-foreground">
		{#if git && (git.changed || git.ahead)}
			<span class="font-mono tabular-nums" title="{git.changed} changed files, {git.ahead} commits not pushed">
				<span class="text-success">+{git.insertions}</span> <span class="text-danger">−{git.deletions}</span>{#if git.ahead} · ↑{git.ahead}{/if}
			</span>
		{/if}
		<span title={sum?.updatedAt ?? s.lastStartedAt ?? s.createdAt}>{ago(sum?.updatedAt ?? s.lastStartedAt ?? s.createdAt)}</span>
		<span class="ml-auto flex items-center gap-1.5">
			{#if s.rcUrl && running}
				<a class="btn btn-ghost btn-sm" href={s.rcUrl} target="_blank" rel="noopener" title="Open in claude.ai (Remote Control)"><BrandIcon brand="claude" class="size-3.5" />Remote</a>
			{/if}
			{#if running || s.status === 'error'}
				<Menu items={endItems} side="top">
					{#snippet trigger({ toggle })}
						<button class="btn btn-danger btn-sm" title="Stop or delete this session" disabled={busy} onclick={toggle}>
							{#if busy}<LoaderCircle class="animate-spin" />{:else}<CircleStop />{/if}End session<ChevronDown />
						</button>
					{/snippet}
				</Menu>
			{/if}
			{#if !running && s.status !== 'starting'}
				<button class="btn btn-ghost btn-sm" title="Start and continue the newest conversation" disabled={busy} onclick={() => act(() => startSession(s))}>
					{#if busy}<LoaderCircle class="animate-spin" />{:else}<Play />{/if}Start
				</button>
			{/if}
			<a class="btn btn-secondary btn-sm" href="/s/{s.id}">Open<ArrowRight /></a>
		</span>
	</footer>
</article>
