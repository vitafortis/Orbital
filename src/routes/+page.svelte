<script lang="ts">
	import { ArrowLeft, ChevronRight, Play, Plus, RotateCcw, Trash2, Wand } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { repoLabel } from '#lib/launch.ts';
	import Dialog from '#lib/components/Dialog.svelte';
	import GettingStarted from '#lib/components/GettingStarted.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SessionCard from '#lib/components/SessionCard.svelte';
	import StateDot from '#lib/components/StateDot.svelte';
	import { ago, plural } from '#lib/client/format.ts';
	import { deleteSession, startSession } from '#lib/client/sessions.ts';
	import { useSessions } from '#lib/client/state.svelte.ts';
	import { displayState, sortByRecency } from '#lib/session-state.ts';
	import type { Session } from '#lib/types.ts';
	import type { PageProps } from './$types';

	const shown = useSessions();

	let { data }: PageProps = $props();

	// Newest top-left to oldest bottom-right, whatever the state, so cards stay where you last saw them.
	const ordered = $derived(sortByRecency(shown.list, shown.live));
	// Offline: no container to talk to, either stopped or failed to start.
	const isOffline = (s: Session) => s.status === 'stopped' || s.status === 'error';
	const online = $derived(ordered.filter((s) => !isOffline(s)));
	const offline = $derived(ordered.filter(isOffline));
	const states = $derived(online.map((s) => displayState(s, shown.live[s.id])));
	const count = (st: string) => states.filter((x) => x === st).length;

	const description = $derived.by(() => {
		if (!shown.list.length) return 'Claude Code sessions on your own hardware, one container each.';
		const parts = [`${online.length} online`];
		if (count('waiting')) parts.push(`${count('waiting')} need${count('waiting') === 1 ? 's' : ''} you`);
		if (count('working')) parts.push(`${count('working')} working`);
		if (offline.length) parts.push(`${offline.length} offline`);
		return parts.join(' · ');
	});

	// This browser remembers which sections are folded.
	let folded = $state<Record<string, boolean>>({});
	onMount(() => {
		try {
			for (const id of ['online', 'offline']) folded[id] = localStorage.getItem(`orb.overview.${id}`) === '0';
		} catch {}
	});
	function fold(id: string) {
		folded[id] = !folded[id];
		try {
			localStorage.setItem(`orb.overview.${id}`, folded[id] ? '0' : '1');
		} catch {}
	}

	// New session: start fresh, or bring back an offline one. With nothing to resume, go straight to /new.
	let choosing = $state(false);
	let step = $state<'pick' | 'resume'>('pick');
	let resuming = $state<string | null>(null);
	function newSession() {
		if (!offline.length) return goto('/new');
		step = 'pick';
		choosing = true;
	}
	async function resume(s: Session) {
		resuming = s.id;
		await startSession(s);
		resuming = null;
		choosing = false;
		goto(`/s/${s.id}`);
	}
</script>

<svelte:head><title>Sessions · Orbital</title></svelte:head>

{#snippet heading(id: string, title: string)}
	<button
		type="button"
		class="mb-2.5 flex items-center gap-1.5 rounded px-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/80 uppercase hover:text-foreground"
		aria-expanded={!folded[id]}
		onclick={() => fold(id)}
	>
		<ChevronRight class="size-3.5 shrink-0 transition-transform {folded[id] ? '' : 'rotate-90'}" />{title}
	</button>
{/snippet}

<div class="h-full overflow-y-auto">
	<PageHeader title="Sessions" {description}>
		{#snippet actions()}
			<!-- Until the first session, the guide below is the way in. -->
			{#if shown.list.length}
				<a href="/new?mode=skill&command=/code-review" class="btn btn-secondary" title="Start a session that runs /code-review on a pull request"><Wand />Review a PR</a>
				<button class="btn btn-primary" onclick={newSession}><Plus />New session</button>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="space-y-8 px-4 pb-10 sm:px-8">
		{#if !shown.list.length}
			<GettingStarted accounts={data.accounts} signingIn={data.signingIn} githubAccounts={data.githubAccounts} />
		{/if}

		{#if online.length}
			<section>
				{@render heading('online', `Online · ${plural(online.length, 'session')}`)}
				{#if !folded.online}
					<div class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
						{#each online as s (s.id)}
							<SessionCard session={s} live={shown.live[s.id]} />
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		{#if offline.length}
			<section>
				{@render heading('offline', `Offline · ${plural(offline.length, 'session')}`)}
				{#if !folded.offline}
					<div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
						{#each offline as s (s.id)}
							{@const sum = shown.live[s.id]?.summary}
							{@const failed = s.status === 'error'}
							<div class="card glow {failed ? 'glow-red' : 'glow-gray'} flex items-center gap-3 border-transparent px-4 py-3">
								<StateDot state={failed ? 'error' : 'stopped'} />
								<a href="/s/{s.id}" class="min-w-0 flex-1">
									<span class="block truncate text-[0.8125rem] font-medium hover:text-primary">{s.name}</span>
									<span class="block truncate text-xs {failed ? 'text-danger' : 'text-muted-foreground'}">
										{#if failed}Failed to start · {/if}{repoLabel(s)}{#if sum?.title} · {sum.title}{:else if sum?.lastPrompt} · {sum.lastPrompt}{/if}
									</span>
								</a>
								<span class="hidden text-xs text-muted-foreground sm:block">{ago(sum?.updatedAt ?? s.stoppedAt ?? s.lastStartedAt ?? s.createdAt)}</span>
								<button class="btn btn-secondary btn-sm" title="Start and continue the newest conversation" onclick={() => startSession(s)}><Play />{failed ? 'Retry' : 'Resume'}</button>
								<button class="btn btn-ghost btn-icon btn-sm hover:text-danger" title="Delete" onclick={() => deleteSession(s, '')}><Trash2 /></button>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</div>
</div>

<Dialog bind:open={choosing} title={step === 'pick' ? 'New session' : 'Resume a session'} description={step === 'pick' ? undefined : 'Starts its container again and continues the newest conversation.'} width="max-w-md">
	{#if step === 'pick'}
		<div class="grid gap-2">
			<a href="/new" class="card flex items-start gap-3 px-4 py-3 hover:border-primary/50" onclick={() => (choosing = false)}>
				<Plus class="mt-0.5 size-4 shrink-0 text-primary" />
				<span>
					<span class="block text-[0.8125rem] font-medium">New</span>
					<span class="block text-xs text-muted-foreground">Pick a repo and start from scratch.</span>
				</span>
			</a>
			<button class="card flex items-start gap-3 px-4 py-3 text-left hover:border-primary/50" onclick={() => (step = 'resume')}>
				<RotateCcw class="mt-0.5 size-4 shrink-0 text-primary" />
				<span>
					<span class="block text-[0.8125rem] font-medium">Resume</span>
					<span class="block text-xs text-muted-foreground">Restart one of {plural(offline.length, 'offline session')}.</span>
				</span>
			</button>
		</div>
	{:else}
		<button class="btn btn-ghost btn-sm mb-2 -ml-2" onclick={() => (step = 'pick')}><ArrowLeft />Back</button>
		<div class="grid gap-1">
			{#each offline as s (s.id)}
				{@const sum = shown.live[s.id]?.summary}
				<button class="flex items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-accent disabled:opacity-50" disabled={!!resuming} onclick={() => resume(s)}>
					<StateDot state={s.status === 'error' ? 'error' : 'stopped'} />
					<span class="min-w-0 flex-1">
						<span class="block truncate text-[0.8125rem] font-medium">{s.name}</span>
						<span class="block truncate text-xs text-muted-foreground">{repoLabel(s)}{#if sum?.title} · {sum.title}{/if}</span>
					</span>
					<span class="text-xs text-muted-foreground">{resuming === s.id ? 'Starting…' : ago(sum?.updatedAt ?? s.stoppedAt ?? s.lastStartedAt ?? s.createdAt)}</span>
				</button>
			{/each}
		</div>
	{/if}
</Dialog>
