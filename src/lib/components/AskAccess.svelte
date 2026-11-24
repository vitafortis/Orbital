<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { Send } from '@lucide/svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { until } from '#lib/client/format.ts';
	import { toast } from '#lib/client/state.svelte.ts';

	/**
	 * Asking the admins for more access: a viewer for member, a member for admin. The request lands
	 * in the admins' To do and under Settings → Sign-in & users. `inline`: a link in running text.
	 */
	let { inline = false }: { inline?: boolean } = $props();

	const viewer = $derived(page.data.viewer);
	const want = $derived(viewer?.role === 'viewer' ? 'member' : viewer?.role === 'member' ? 'admin' : null);
	let open = $state(false);
	let note = $state('');
	let busy = $state(false);

	async function ask(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			await api.post('/api/access-request', { role: want, note });
			toast('success', 'Asked the admins', 'It shows in their To do.');
			open = false;
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't send the request", errorMessage(err));
		}
		busy = false;
	}

	async function takeBack() {
		await api.del('/api/access-request').catch(() => {});
		await invalidateAll();
	}
</script>

{#if viewer && viewer.id !== 'open'}
	{#if viewer.tempUntil}
		<span class="text-warning">You're {viewer.role === 'admin' ? 'an admin' : 'a member'} for now: it ends {until(viewer.tempUntil)}.</span>
	{:else if viewer.asked}
		<span>You asked to be {viewer.asked === 'admin' ? 'an admin' : 'a member'}. <button type="button" class="font-medium text-primary hover:underline" onclick={takeBack}>Take it back</button></span>
	{:else if want && !open}
		<button type="button" class={inline ? 'font-medium text-primary hover:underline' : 'btn btn-secondary btn-sm'} onclick={() => (open = true)}>{want === 'member' ? 'Ask for member access' : 'Ask to be an admin'}</button>
	{:else if want}
		<form class="{inline ? 'mt-2' : ''} flex max-w-md items-center gap-2" onsubmit={ask}>
			<input class="input h-8 text-xs" placeholder="What for? (optional)" maxlength="500" bind:value={note} aria-label="Why you need it" />
			<button class="btn btn-primary btn-sm shrink-0" disabled={busy}><Send />Ask</button>
			<button type="button" class="btn btn-ghost btn-sm shrink-0" onclick={() => (open = false)}>Cancel</button>
		</form>
	{/if}
{/if}
