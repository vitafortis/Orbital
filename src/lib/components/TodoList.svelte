<script lang="ts">
	import { Check, Copy, Globe, Laptop, SquareTerminal } from '@lucide/svelte';
	import { copyText } from '#lib/client/clipboard.ts';
	import { ago } from '#lib/client/format.ts';
	import { markTodo, runInShell, WHERE_LABEL } from '#lib/client/todos.ts';
	import type { TodoItem } from '#lib/types.ts';

	/**
	 * Things a person has to do for a session: what to do, why, the exact command to copy (or
	 * type into the Shell tab), and a box to tick when it's done.
	 */
	let {
		items,
		running = () => false,
		tell,
		compact = false,
		onchange
	}: {
		items: TodoItem[];
		/** Whether an item's session is running (Run in Shell needs it). */
		running?: (sessionId: string) => boolean;
		/** Tick tells the session it's done. */
		tell: boolean;
		compact?: boolean;
		onchange?: () => void;
	} = $props();

	let busy = $state<string | null>(null);
	async function toggle(t: TodoItem) {
		busy = t.id;
		if (await markTodo(t, !t.doneAt, tell)) onchange?.();
		busy = null;
	}
	const WHERE_ICON = { 'your-machine': Laptop, 'session-shell': SquareTerminal, browser: Globe, other: null };
</script>

<ul class="space-y-1.5">
	{#each items as t (t.id)}
		{@const Icon = WHERE_ICON[t.where]}
		<li class="flex items-start gap-2.5 rounded-lg {compact ? 'py-1' : 'border border-border bg-card px-3 py-2.5'} {t.doneAt ? 'opacity-60' : ''}">
			<button
				type="button"
				class="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors {t.doneAt ? 'border-success bg-success text-white' : 'border-muted-foreground/50 hover:border-success'}"
				aria-label={t.doneAt ? 'Mark as not done' : 'Mark as done'}
				title={t.doneAt ? 'Mark as not done' : tell ? 'Done (and tell the session)' : 'Done'}
				disabled={busy === t.id}
				onclick={() => toggle(t)}
			>
				{#if t.doneAt}<Check class="size-3" strokeWidth={3} />{/if}
			</button>
			<div class="min-w-0 flex-1">
				<p class="text-[0.8125rem] font-medium {t.doneAt ? 'line-through' : ''}">{t.title}</p>
				{#if t.why && !compact}<p class="mt-0.5 text-xs text-muted-foreground">{t.why}</p>{/if}
				{#if t.command}
					<div class="mt-1.5 flex items-start gap-1">
						<code class="min-w-0 flex-1 rounded-md bg-muted px-2 py-1 font-mono text-[0.75rem] break-all whitespace-pre-wrap">{t.command}</code>
						<button type="button" class="btn btn-ghost btn-icon btn-sm shrink-0" title="Copy the command" onclick={() => copyText(t.command!, 'Copied the command')}><Copy /></button>
						{#if t.where === 'session-shell' && running(t.sessionId) && !t.doneAt}
							<button type="button" class="btn btn-secondary btn-sm shrink-0" title="Open the Shell tab with it typed in, for you to check and run" onclick={() => runInShell(t)}><SquareTerminal />Run in Shell</button>
						{/if}
					</div>
				{/if}
				{#if !compact}
					<p class="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
						{#if Icon}<Icon class="size-3" />{WHERE_LABEL[t.where]} ·{/if}
						{t.source === 'agent' ? 'From the agent' : 'Added by you'} · {ago(t.at)}
					</p>
				{/if}
			</div>
		</li>
	{/each}
</ul>
