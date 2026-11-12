<script lang="ts">
	import { ArrowRight, ChevronRight, ListChecks, LoaderCircle, Plus, TriangleAlert } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import StateDot from '#lib/components/StateDot.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import TodoList from '#lib/components/TodoList.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { plural } from '#lib/client/format.ts';
	import { useSessions } from '#lib/client/state.svelte.ts';
	import { addTodo, setTellByDefault, tellByDefault, WHERE_LABEL } from '#lib/client/todos.ts';
	import { displayState, sortByRecency } from '#lib/session-state.ts';
	import type { SystemTodo, TodoItem, TodoWhere } from '#lib/types.ts';

	/** What every session needs from a person, in one place: logins, commands, approvals. */
	const shown = useSessions();
	let items = $state<TodoItem[]>([]);
	let system = $state<SystemTodo[]>([]);
	let loaded = $state(false);
	let error = $state('');

	async function load() {
		try {
			const r = await api.get<{ items: TodoItem[]; system: SystemTodo[] }>('/api/todos');
			items = r.items;
			system = r.system;
			error = '';
		} catch (err) {
			error = errorMessage(err);
		}
		loaded = true;
	}
	onMount(() => void load());
	// Again when a session's list changes (the agent added something, say).
	const openKey = $derived(Object.values(shown.live).flatMap((l) => (l.todos ?? []).map((t) => t.id)).sort().join());
	$effect(() => {
		void openKey;
		if (loaded) void load();
	});

	let tell = $state(true);
	onMount(() => (tell = tellByDefault()));

	const sessionById = $derived(new Map(shown.list.map((s) => [s.id, s])));
	const running = (id: string) => sessionById.get(id)?.status === 'running';
	// Sessions with something open, newest activity first.
	const groups = $derived(
		sortByRecency(shown.list, shown.live)
			.map((s) => ({ session: s, items: items.filter((t) => t.sessionId === s.id && !t.doneAt).sort((a, b) => a.at.localeCompare(b.at)) }))
			.filter((g) => g.items.length)
	);
	const done = $derived(items.filter((t) => t.doneAt).sort((a, b) => b.doneAt!.localeCompare(a.doneAt!)));
	const openCount = $derived(groups.reduce((n, g) => n + g.items.length, 0) + system.length);
	let showDone = $state(false);

	// ── adding one ──
	let adding = $state(false);
	let f = $state({ sessionId: '', title: '', command: '', where: 'your-machine' as TodoWhere });
	let saving = $state(false);
	function openAdd() {
		f = { sessionId: f.sessionId || shown.list[0]?.id || '', title: '', command: '', where: 'your-machine' };
		adding = true;
	}
	async function add(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		if (await addTodo(f.sessionId, { title: f.title.trim(), command: f.command.trim() || undefined, where: f.where })) {
			adding = false;
			await load();
		}
		saving = false;
	}
</script>

<svelte:head><title>To do · Orbital</title></svelte:head>

<div class="h-full overflow-y-auto">
	<PageHeader title="To do" description={openCount ? `${plural(openCount, 'thing')} for you: logins, commands to run, approvals.` : 'What sessions need from you: logins, commands to run, approvals.'}>
		{#snippet actions()}
			{#if shown.list.length}<button class="btn btn-secondary" onclick={openAdd}><Plus />Add</button>{/if}
		{/snippet}
	</PageHeader>

	<div class="max-w-3xl space-y-6 px-4 pb-10 sm:px-8">
		<label class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
			<span class="text-[0.8125rem]">
				<span class="block font-medium">Tell the session when I tick something</span>
				<span class="block text-xs text-muted-foreground">It gets “Done: …” as a message, and carries on.</span>
			</span>
			<Switch checked={tell} label="Tell the session" onchange={(v) => ((tell = v), setTellByDefault(v))} />
		</label>

		{#if !loaded}
			<p class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading…</p>
		{:else}
			{#if error}<p class="text-xs text-danger">{error}</p>{/if}

			{#if system.length}
				<section>
					<h2 class="mb-2 px-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/80 uppercase">From Orbital</h2>
					<ul class="space-y-1.5">
						{#each system as t (t.id)}
							<li class="flex items-center gap-3 rounded-lg border border-warning/40 bg-card px-3 py-2.5">
								<TriangleAlert class="size-4 shrink-0 text-warning" />
								<div class="min-w-0 flex-1">
									<p class="text-[0.8125rem] font-medium">{t.title}</p>
									<p class="text-xs text-muted-foreground">{t.why}</p>
								</div>
								<a class="btn btn-secondary btn-sm" href={t.href}>Fix<ArrowRight /></a>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#each groups as g (g.session.id)}
				<section>
					<a href="/s/{g.session.id}" class="mb-2 flex items-center gap-2 px-1 text-[0.8125rem] font-semibold hover:text-primary">
						<StateDot state={displayState(g.session, shown.live[g.session.id])} />{g.session.name}
						<span class="font-normal text-muted-foreground">· {plural(g.items.length, 'item')}</span>
					</a>
					<TodoList items={g.items} {running} {tell} onchange={load} />
				</section>
			{/each}

			{#if !groups.length && !system.length}
				<div class="card">
					<EmptyState
						icon={ListChecks}
						title="Nothing for you to do"
						body="When a session needs you to log in, run a command or approve something, Claude adds it here with the exact command (sessions started on this release, or after Session → Restart Claude). You can add your own too."
					>
						{#snippet action()}{#if shown.list.length}<button class="btn btn-secondary btn-sm" onclick={openAdd}><Plus />Add one</button>{/if}{/snippet}
					</EmptyState>
				</div>
			{/if}

			{#if done.length}
				<section>
					<button class="flex items-center gap-1.5 px-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/80 uppercase hover:text-foreground" onclick={() => (showDone = !showDone)}>
						<ChevronRight class="size-3.5 transition-transform {showDone ? 'rotate-90' : ''}" />Done this week · {done.length}
					</button>
					{#if showDone}
						<div class="mt-2"><TodoList items={done} {running} {tell} compact onchange={load} /></div>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</div>

<Dialog bind:open={adding} title="Add a to-do" description="Something you need to do for a session, to keep it with the rest." width="max-w-lg">
	<form id="todo-add" class="space-y-3" onsubmit={add}>
		<div>
			<label class="label" for="td-session">Session</label>
			<select id="td-session" class="input" bind:value={f.sessionId} required>
				{#each shown.list as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
			</select>
		</div>
		<div>
			<label class="label" for="td-title">What</label>
			<input id="td-title" class="input" placeholder="Approve the staging deploy" bind:value={f.title} required maxlength="200" />
		</div>
		<div>
			<label class="label" for="td-command">Command <span class="font-normal text-muted-foreground/70">(optional)</span></label>
			<input id="td-command" class="input font-mono text-[0.8125rem]" placeholder="aws sso login --profile staging" bind:value={f.command} />
		</div>
		<div>
			<label class="label" for="td-where">Where</label>
			<select id="td-where" class="input" bind:value={f.where}>
				{#each ['your-machine', 'session-shell', 'browser', 'other'] as const as w (w)}<option value={w}>{WHERE_LABEL[w] || 'Somewhere else'}</option>{/each}
			</select>
		</div>
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (adding = false)}>Cancel</button>
		<button class="btn btn-primary" form="todo-add" disabled={saving}>{#if saving}<LoaderCircle class="animate-spin" />{/if}Add</button>
	{/snippet}
</Dialog>
