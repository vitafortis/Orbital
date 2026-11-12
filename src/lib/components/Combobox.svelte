<script lang="ts" module>
	export type ComboOption = { value: string; label: string; detail?: string; meta?: string };
</script>

<script lang="ts">
	import type { Component } from 'svelte';
	import { LoaderCircle } from '@lucide/svelte';

	/**
	 * A text box that suggests as you type, like the repo picker: for long lists (pull requests,
	 * branches) where a dropdown is no use. What's typed can be used as is (`onpick` isn't
	 * required); `search` finds more, past the loaded options, once typing pauses.
	 */
	let {
		id,
		value = $bindable(''),
		options,
		placeholder = '',
		icon: Icon,
		mono = false,
		search,
		onpick,
		oninput
	}: {
		id: string;
		value: string;
		/** The loaded options; filtered here by every word typed. */
		options: ComboOption[];
		placeholder?: string;
		icon?: Component<{ class?: string }>;
		mono?: boolean;
		/** More options for what's typed, from the server (after a pause). */
		search?: (q: string, signal: AbortSignal) => Promise<ComboOption[]>;
		onpick?: (o: ComboOption) => void;
		oninput?: () => void;
	} = $props();

	let open = $state(false);
	let index = $state(0);
	let found = $state<ComboOption[]>([]);
	let searching = $state(false);

	const words = $derived(value.toLowerCase().replace(/^#/, '').split(/\s+/).filter(Boolean));
	const local = $derived(
		(words.length ? options.filter((o) => words.every((w) => `${o.value} ${o.label} ${o.detail ?? ''}`.toLowerCase().includes(w))) : options).slice(0, 50)
	);
	const matches = $derived([...local, ...found.filter((f) => !local.some((l) => l.value === f.value))]);

	// Past the loaded options: ask the server, after a pause in typing.
	$effect(() => {
		const q = value.trim();
		found = [];
		if (!search || !q || !open) return;
		const ctrl = new AbortController();
		const t = setTimeout(async () => {
			searching = true;
			try {
				const r = await search(q, ctrl.signal);
				if (!ctrl.signal.aborted) found = r;
			} catch {}
			if (!ctrl.signal.aborted) searching = false;
		}, 350);
		return () => {
			clearTimeout(t);
			ctrl.abort();
			searching = false;
		};
	});

	function pick(o: ComboOption) {
		open = false;
		onpick?.(o);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			open = true;
			const n = matches.length;
			if (n) index = (index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
		} else if (e.key === 'Enter' && open && matches[index]) {
			e.preventDefault();
			pick(matches[index]);
		} else if (e.key === 'Escape' && open) {
			e.preventDefault();
			open = false;
		}
	}
</script>

<div class="relative">
	<div class="relative">
		{#if Icon}<Icon class="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />{/if}
		<input
			{id}
			class="input {Icon ? 'pl-9' : ''} {mono ? 'font-mono text-[0.8125rem]' : ''}"
			{placeholder}
			bind:value
			autocomplete="off"
			spellcheck="false"
			role="combobox"
			aria-expanded={open && matches.length > 0}
			aria-controls="{id}-list"
			onfocus={() => (open = true)}
			onblur={() => setTimeout(() => (open = false), 150)}
			oninput={() => {
				open = true;
				index = 0;
				oninput?.();
			}}
			{onkeydown}
		/>
		{#if searching}<LoaderCircle class="absolute top-2.5 right-3 size-4 animate-spin text-muted-foreground" />{/if}
	</div>
	{#if open && matches.length}
		<ul id="{id}-list" role="listbox" class="absolute z-20 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-surface-lg">
			{#each matches as o, i (o.value)}
				<li role="option" aria-selected={i === index}>
					<button
						type="button"
						class="flex w-full items-start gap-2.5 rounded-lg px-3 py-1.5 text-left {i === index ? 'bg-accent' : ''}"
						onmousedown={(e) => e.preventDefault()}
						onmouseenter={() => (index = i)}
						onclick={() => pick(o)}
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-[0.8125rem] {mono ? 'font-mono' : ''}">{o.label}</span>
							{#if o.detail}<span class="block truncate text-xs text-muted-foreground">{o.detail}</span>{/if}
						</span>
						{#if o.meta}<span class="shrink-0 text-[0.6875rem] text-muted-foreground">{o.meta}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
