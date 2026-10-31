<script lang="ts">
	import { goto } from '$app/navigation';
	import { repoLabel } from '#lib/launch.ts';
	import { CornerDownLeft, KeyRound, LayoutDashboard, Moon, Plus, Search, Settings, TerminalSquare, Wand, Workflow } from '@lucide/svelte';
	import StateDot from './StateDot.svelte';
	import { setTheme, theme, useSessions } from '#lib/client/state.svelte.ts';
	import { displayState, sortForOverview, type DisplayState } from '#lib/session-state.ts';
	import type { Component } from 'svelte';

	const shown = useSessions();

	type Item = { id: string; label: string; hint?: string; icon?: Component; state?: DisplayState; run: () => void };

	let open = $state(false);
	let query = $state('');
	let index = $state(0);
	let input = $state<HTMLInputElement>();
	let dialog: HTMLDialogElement;

	const items = $derived.by((): Item[] => [
		...sortForOverview(shown.list, shown.live).map((s) => ({
			id: `s:${s.id}`,
			label: s.name,
			hint: repoLabel(s),
			state: displayState(s, shown.live[s.id]),
			run: () => goto(`/s/${s.id}`)
		})),
		{ id: 'new', label: 'New session', icon: Plus, run: () => goto('/new') },
		{ id: 'review', label: 'Review a pull request', hint: '/code-review', icon: Wand, run: () => goto('/new?mode=skill&command=/code-review') },
		{ id: 'automations', label: 'Automations', hint: 'Linear', icon: Workflow, run: () => goto('/automations') },
		{ id: 'home', label: 'All sessions', icon: LayoutDashboard, run: () => goto('/') },
		{ id: 'accounts', label: 'Accounts', hint: 'Claude and GitHub', icon: KeyRound, run: () => goto('/accounts') },
		{ id: 'settings', label: 'Settings', icon: Settings, run: () => goto('/settings') },
		{ id: 'theme', label: theme.value === 'dark' ? 'Light theme' : 'Dark theme', icon: Moon, run: () => setTheme(theme.value === 'dark' ? 'light' : 'dark') }
	]);

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return items;
		return items
			.map((it) => {
				const text = `${it.label} ${it.hint ?? ''}`.toLowerCase();
				const at = text.indexOf(q);
				// Every word must appear; earlier and label matches rank first.
				const all = q.split(/\s+/).every((w) => text.includes(w));
				return { it, score: !all ? -1 : at === -1 ? 50 : at < it.label.length ? at : 20 + at };
			})
			.filter((x) => x.score >= 0)
			.sort((a, b) => a.score - b.score)
			.map((x) => x.it);
	});

	$effect(() => {
		void query;
		index = 0;
	});

	$effect(() => {
		if (open && !dialog.open) {
			dialog.showModal();
			query = '';
			queueMicrotask(() => input?.focus());
		} else if (!open && dialog.open) dialog.close();
	});

	function run(it: Item | undefined) {
		if (!it) return;
		open = false;
		it.run();
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			open = !open;
		}
	}

	function onInputKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			index = Math.min(filtered.length - 1, index + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			index = Math.max(0, index - 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			run(filtered[index]);
		}
	}
</script>

<svelte:window {onkeydown} />

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	onclick={(e) => e.target === dialog && (open = false)}
	class="m-auto mt-[12vh] w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-surface-lg backdrop:bg-black/50 backdrop:backdrop-blur-sm"
>
	{#if open}
		<div class="flex items-center gap-2.5 border-b border-border px-4">
			<Search class="size-4 text-muted-foreground" />
			<input bind:this={input} bind:value={query} onkeydown={onInputKey} class="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70" placeholder="Jump to a session or page…" />
			<span class="kbd">esc</span>
		</div>
		<ul class="max-h-[50vh] overflow-y-auto p-1.5">
			{#each filtered as it, i (it.id)}
				<li>
					<button
						class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[0.8125rem] {i === index ? 'bg-accent text-foreground' : 'text-muted-foreground'}"
						onmouseenter={() => (index = i)}
						onclick={() => run(it)}
					>
						{#if it.state}
							<span class="grid size-4 place-items-center"><StateDot state={it.state} /></span>
						{:else if it.icon}
							<it.icon class="size-4" />
						{:else}
							<TerminalSquare class="size-4" />
						{/if}
						<span class="font-medium text-foreground">{it.label}</span>
						{#if it.hint}<span class="truncate text-xs">{it.hint}</span>{/if}
						{#if i === index}<CornerDownLeft class="ml-auto size-3.5 shrink-0" />{/if}
					</button>
				</li>
			{:else}
				<li class="px-3 py-6 text-center text-xs text-muted-foreground">Nothing matches.</li>
			{/each}
		</ul>
	{/if}
</dialog>
