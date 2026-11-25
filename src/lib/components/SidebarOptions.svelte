<script lang="ts" module>
	/** What the sidebar's session list shows, and in which order. This browser remembers it. */
	export type SidebarView = { show: 'all' | 'online'; who: 'everyone' | 'people' | 'mine'; sort: 'recent' | 'name' };
	export const DEFAULT_VIEW: SidebarView = { show: 'all', who: 'everyone', sort: 'recent' };
	export const isDefaultView = (v: SidebarView) => v.show === DEFAULT_VIEW.show && v.who === DEFAULT_VIEW.who && v.sort === DEFAULT_VIEW.sort;
</script>

<script lang="ts">
	import { ListFilter } from '@lucide/svelte';

	let { view = $bindable() }: { view: SidebarView } = $props();

	let open = $state(false);
	let root: HTMLDivElement;

	const ROWS = [
		{ key: 'show', label: 'Show', options: [{ value: 'all', label: 'All' }, { value: 'online', label: 'Online' }] },
		{ key: 'who', label: 'Started by', options: [{ value: 'everyone', label: 'Anyone' }, { value: 'people', label: 'People', hint: 'Not Linear automations' }, { value: 'mine', label: 'Me' }] },
		{ key: 'sort', label: 'Sort', options: [{ value: 'recent', label: 'Recent' }, { value: 'name', label: 'A–Z' }] }
	] as const;
</script>

<svelte:window onclick={(e) => open && !root.contains(e.target as Node) && (open = false)} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="relative" bind:this={root}>
	<button
		type="button"
		class="grid size-6 place-items-center rounded-md hover:bg-accent hover:text-foreground {isDefaultView(view) ? 'text-muted-foreground/80' : 'text-primary'}"
		title="Which sessions to list, and in which order"
		aria-label="Sidebar view options"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<ListFilter class="size-3.5" />
	</button>
	{#if open}
		<div class="absolute top-full right-0 z-30 mt-1.5 w-60 space-y-2.5 rounded-xl border border-border bg-card p-3 text-xs shadow-surface-lg normal-case tracking-normal">
			{#each ROWS as row (row.key)}
				<div>
					<p class="mb-1 font-medium text-muted-foreground">{row.label}</p>
					<div class="flex rounded-lg border border-border bg-background p-0.5" role="radiogroup" aria-label={row.label}>
						{#each row.options as o (o.value)}
							<button
								type="button"
								role="radio"
								aria-checked={view[row.key] === o.value}
								title={'hint' in o ? o.hint : undefined}
								class="flex-1 rounded-md px-2 py-1 {view[row.key] === o.value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}"
								onclick={() => (view = { ...view, [row.key]: o.value })}>{o.label}</button
							>
						{/each}
					</div>
				</div>
			{/each}
			<p class="text-[0.6875rem] text-muted-foreground">Pinned sessions stay on top and always show, as does the one you have open.</p>
			{#if !isDefaultView(view)}<button type="button" class="font-medium text-primary hover:underline" onclick={() => (view = { ...DEFAULT_VIEW })}>Reset</button>{/if}
		</div>
	{/if}
</div>
