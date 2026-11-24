<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { LoaderCircle } from '@lucide/svelte';
	import BrandIcon from '#lib/components/BrandIcon.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { confirmAction, toast } from '#lib/client/state.svelte.ts';
	import type { NotionConnection } from '#lib/server/store.ts';

	/** Your own Notion sign-in: sessions you start reach Notion as you. */
	let { connection }: { connection: NotionConnection | null } = $props();

	let notionBusy = $state(false);
	async function connectNotion() {
		notionBusy = true;
		try {
			const r = await api.post<{ url: string }>('/api/notion/connect');
			location.href = r.url;
		} catch (err) {
			toast('error', "Couldn't start the Notion sign-in", errorMessage(err));
			notionBusy = false;
		}
	}
	async function disconnectNotion() {
		const ok = await confirmAction({ title: 'Disconnect your Notion?', body: 'Sessions you started lose it at once, and Orbital asks Notion to revoke the sign-in.', confirmLabel: 'Disconnect', danger: true });
		if (!ok) return;
		await api.del('/api/notion/connect').catch((err) => toast('error', "Couldn't disconnect", errorMessage(err)));
		await invalidateAll();
	}
	// Back from Notion's sign-in.
	$effect(() => {
		const q = new URLSearchParams(location.search);
		if (q.get('notion') === 'connected') toast('success', 'Connected your Notion', 'Sessions you start get it when Claude next starts.');
		else if (q.get('notion_error')) toast('error', "Couldn't connect your Notion", q.get('notion_error') ?? '');
		if (q.has('notion') || q.has('notion_error')) history.replaceState(history.state, '', location.pathname + location.hash);
	});
</script>

	<section id="notion">
		<div class="mb-2 flex min-h-8 items-end">
			<h3 class="flex items-center gap-2 text-[0.8125rem] font-semibold"><BrandIcon brand="notion" />Notion</h3>
		</div>
		<div class="card flex flex-wrap items-center gap-3 px-4 py-3">
			{#if connection}
				<div class="min-w-0 flex-1 basis-60 text-[0.8125rem]">
					<p class="font-medium">Connected</p>
					<p class="text-xs {connection.renewError ? 'text-warning' : 'text-muted-foreground'}">
						{connection.renewError ?? `Since ${new Date(connection.createdAt).toLocaleDateString()}. Renews itself; sessions you start get it as notion.`}
					</p>
				</div>
				{#if connection.renewError}<button class="btn btn-secondary btn-sm" disabled={notionBusy} onclick={connectNotion}>Connect again</button>{/if}
				<button class="btn btn-ghost btn-sm hover:text-danger" onclick={disconnectNotion}>Disconnect</button>
			{:else}
				<p class="min-w-0 flex-1 basis-60 text-xs text-muted-foreground">Not connected. Claude in your sessions reaches Notion as you: what you can see, with edits under your name. You'll choose what to allow on Notion's page.</p>
				<button class="btn btn-primary btn-sm" disabled={notionBusy} onclick={connectNotion}>{#if notionBusy}<LoaderCircle class="animate-spin" />{:else}<BrandIcon brand="notion" class="size-4" />{/if}Connect my Notion</button>
			{/if}
		</div>
		<p class="mt-2 text-xs text-muted-foreground">Applies when Claude next starts in your sessions (start one, or Session → Restart Claude). Sessions started before this release, or by automations, have no owner and don't get it.</p>
	</section>