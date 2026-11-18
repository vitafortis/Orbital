<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import PageHeader from './PageHeader.svelte';

	/** Settings' header: one title for every tab, what this tab is for, and the tabs. */
	let { admin, description, actions }: { admin: boolean; description: string; actions?: Snippet } = $props();
	const tabs = $derived([
		{ href: '/settings/accounts', label: 'Accounts' },
		{ href: '/settings/library', label: 'Library' },
		{ href: '/settings/automations', label: 'Automations' },
		{ href: '/settings', label: 'General' },
		...(admin ? [{ href: '/settings/sign-in', label: 'Sign-in & users' }] : [])
	]);
	const active = (href: string) => (href === '/settings' ? page.url.pathname === href : page.url.pathname.startsWith(href));
</script>

<PageHeader title="Settings" {description} {actions} />
<nav class="mb-6 flex gap-1 overflow-x-auto border-b border-border px-4 sm:px-8">
	{#each tabs as t (t.href)}
		<a
			href={t.href}
			class="-mb-px shrink-0 border-b-2 px-3 py-2 text-[0.8125rem] {active(t.href) ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
			aria-current={active(t.href) ? 'page' : undefined}>{t.label}</a
		>
	{/each}
</nav>
