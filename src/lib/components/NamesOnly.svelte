<script lang="ts">
	import { EyeOff } from '@lucide/svelte';
	import { page } from '$app/state';
	import StateBadge from './StateBadge.svelte';
	import { displayState } from '#lib/session-state.ts';
	import { repoLabel } from '#lib/launch.ts';
	import { useSessions } from '#lib/client/state.svelte.ts';
	import type { Session } from '#lib/types.ts';

	/**
	 * Someone else's session that you may only see by name (Settings → Sign-in & users): whose
	 * it is and how it's doing, not its terminal, conversations or files.
	 */
	let { session, owner }: { session: Session; owner: string | null } = $props();
	const shown = useSessions();
	const s = $derived(shown.list.find((x) => x.id === session.id) ?? session);
</script>

<div class="grid h-full place-items-center p-6">
	<div class="card max-w-md space-y-3 p-6 text-center">
		<span class="mx-auto grid size-10 place-items-center rounded-full bg-surface text-muted-foreground"><EyeOff class="size-5" /></span>
		<div>
			<h1 class="text-base font-semibold tracking-tight">{s.name}</h1>
			<p class="text-xs text-muted-foreground">{repoLabel(s)}{owner ? ` · ${owner}'s session` : ''}</p>
		</div>
		<div class="flex justify-center"><StateBadge state={displayState(s, shown.live[s.id])} /></div>
		<p class="text-[0.8125rem] text-muted-foreground">
			{owner ?? 'Its owner'} hasn't shared it with you, so its terminal, conversations and files stay with them. They can turn on <b class="font-medium text-foreground">Everyone can watch</b> in the session's panel{page.data.viewer?.admin ? '' : ', or an admin can share it'}.
		</p>
	</div>
</div>
