<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Dialog from './Dialog.svelte';

	/**
	 * Single-key shortcuts outside text fields (the terminal is one: it gets every key), and a
	 * cheat sheet on "?". `sessions` is the sidebar's order, for [ and ].
	 */
	let { sessions }: { sessions: { id: string }[] } = $props();

	let help = $state(false);
	let pendingG = false;
	let gTimer: ReturnType<typeof setTimeout> | undefined;

	const GO: Record<string, string> = { h: '/', s: '/', t: '/todo', a: '/settings/accounts', l: '/settings/library', u: '/settings/automations', ',': '/settings' };

	const SHEET: [string[], string][] = [
		[['⌘', 'K'], 'Jump to a session or page'],
		[['n'], 'New session'],
		[['[', ']'], 'Previous / next session'],
		[['g', 'h'], 'Home'],
		[['g', 't'], 'To do'],
		[['g', 'a'], 'Accounts'],
		[['g', 'l'], 'Library'],
		[['g', 'u'], 'Automations'],
		[['g', ','], 'Settings'],
		[['⌘', 'B'], 'Collapse the sidebar'],
		[['?'], 'This list']
	];

	function typing(el: EventTarget | null): boolean {
		return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
	}

	function step(by: number) {
		const at = sessions.findIndex((s) => page.url.pathname === `/s/${s.id}`);
		const next = sessions[at < 0 ? (by > 0 ? 0 : sessions.length - 1) : (at + by + sessions.length) % sessions.length];
		if (next) void goto(`/s/${next.id}`);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('dialog[open]')) return;
		if (pendingG) {
			pendingG = false;
			clearTimeout(gTimer);
			const to = GO[e.key];
			if (to) {
				e.preventDefault();
				void goto(to);
			}
			return;
		}
		if (e.key === 'g') {
			pendingG = true;
			gTimer = setTimeout(() => (pendingG = false), 1200);
		} else if (e.key === 'n') {
			e.preventDefault();
			void goto('/new');
		} else if (e.key === '[' || e.key === ']') {
			e.preventDefault();
			step(e.key === ']' ? 1 : -1);
		} else if (e.key === '?') {
			e.preventDefault();
			help = true;
		}
	}
</script>

<svelte:window {onkeydown} />

<Dialog bind:open={help} title="Keyboard shortcuts" description="Outside text fields and the terminal." width="max-w-sm">
	<dl class="space-y-2 text-[0.8125rem]">
		{#each SHEET as [keys, what] (what)}
			<div class="flex items-center justify-between gap-4">
				<dt class="text-muted-foreground">{what}</dt>
				<dd class="flex gap-1">
					{#each keys as k (k)}<kbd class="min-w-6 rounded-md border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">{k}</kbd>{/each}
				</dd>
			</div>
		{/each}
	</dl>
</Dialog>
