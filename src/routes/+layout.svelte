<script lang="ts">
	import '../app.css';
	import { repoLabel } from '#lib/launch.ts';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		LayoutDashboard,
		Plus,
		Moon,
		Sun,
		LogOut,
		Settings,
		KeyRound,
		PanelLeftClose,
		PanelLeftOpen,
		Menu,
		Pin,
		PinOff,
		Workflow,
		X
	} from '@lucide/svelte';
	import type { Session } from '#lib/types.ts';
	import Logo from '#lib/components/Logo.svelte';
	import Shortcuts from '#lib/components/Shortcuts.svelte';
	import Toaster from '#lib/components/Toaster.svelte';
	import ConfirmHost from '#lib/components/ConfirmHost.svelte';
	import CommandPalette from '#lib/components/CommandPalette.svelte';
	import StateDot from '#lib/components/StateDot.svelte';
	import { api } from '#lib/client/api.ts';
	import { connectLive, provideSessions, session, sessions, setTheme, theme } from '#lib/client/state.svelte.ts';
	import { displayState, glowClass, sortByRecency, STATE_META, type DisplayState } from '#lib/session-state.ts';
	import { ago } from '#lib/client/format.ts';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// Seed the shared store from the server render; the live stream keeps it current.
	$effect.pre(() => {
		sessions.list = data.sessions;
		sessions.live = Object.fromEntries(data.live.map((l) => [l.id, l]));
		sessions.seeded = true;
		session.viewer = data.viewer;
	});
	const shown = provideSessions(() => data);

	$effect(() => {
		theme.value = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
	});

	const bare = $derived(page.url.pathname === '/login' || page.url.pathname === '/setup');
	const signedIn = $derived(data.auth === 'authenticated' || data.auth === 'disabled');

	onMount(() => {
		if (!signedIn) return;
		return connectLive();
	});

	let collapsed = $state(false);
	let drawer = $state(false);
	// The session page wants the whole width for its terminal.
	const onSession = $derived(page.url.pathname.startsWith('/s/'));

	$effect(() => {
		void page.url.pathname;
		drawer = false;
	});

	const nav = [
		{ href: '/', label: 'Sessions', icon: LayoutDashboard },
		{ href: '/automations', label: 'Automations', icon: Workflow },
		{ href: '/accounts', label: 'Accounts', icon: KeyRound },
		{ href: '/settings', label: 'Settings', icon: Settings }
	];

	// Pinned sessions stay on top of the sidebar, in this browser.
	let pinned = $state<string[]>([]);
	$effect(() => {
		try {
			pinned = JSON.parse(localStorage.getItem('orb.pinned') ?? '[]');
		} catch {}
	});
	function togglePin(id: string) {
		pinned = pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
		try {
			localStorage.setItem('orb.pinned', JSON.stringify(pinned));
		} catch {}
	}
	const ordered = $derived.by(() => {
		const all = sortByRecency(shown.list, shown.live);
		return [...all.filter((s) => pinned.includes(s.id)), ...all.filter((s) => !pinned.includes(s.id))];
	});

	/** The sidebar's second line: what the session is doing. */
	function doing(s: Session, view: DisplayState): { text: string; tone: string } {
		const sum = shown.live[s.id]?.summary;
		switch (view) {
			case 'waiting':
				return { text: 'Needs you', tone: 'text-warning' };
			case 'working':
				return { text: sum?.todos.find((t) => t.status === 'in_progress')?.content ?? sum?.lastTool ?? 'Working', tone: 'text-primary/90' };
			case 'error':
				return { text: 'Failed to start', tone: 'text-danger' };
			case 'starting':
				return { text: 'Starting…', tone: '' };
			case 'stopped':
				return { text: `Stopped${s.stoppedAt ? ` · ${ago(s.stoppedAt)}` : ''}`, tone: '' };
			default:
				return { text: sum?.title && sum.title !== s.name ? sum.title : STATE_META[view].label, tone: '' };
		}
	}

	async function logout() {
		const r = await api.post<{ redirect: string | null }>('/api/auth/logout');
		if (r.redirect) location.href = r.redirect;
		else goto('/login');
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'b' && !onSession) {
			e.preventDefault();
			collapsed = !collapsed;
		}
	}
</script>

<svelte:head>
	<title>Orbital</title>
</svelte:head>

<svelte:window {onkeydown} />

{#snippet sidebar(compact: boolean)}
	<div class="flex h-14 items-center gap-2.5 px-3.5">
		<a href="/" class="flex items-center gap-2.5">
			<Logo size={26} />
			{#if !compact}
				<span class="text-[0.9375rem] font-semibold tracking-tight">Orbital</span>
			{/if}
		</a>
		{#if drawer}
			<button class="btn btn-ghost btn-icon btn-sm ml-auto" aria-label="Close menu" onclick={() => (drawer = false)}><X /></button>
		{/if}
	</div>

	<div class="px-2 pb-2">
		<a href="/new" class="btn btn-primary w-full {compact ? 'btn-icon btn-sm' : 'h-8'}" title="New session"><Plus />{#if !compact}New session{/if}</a>
	</div>

	<nav class="space-y-0.5 px-2">
		{#each nav as item (item.href)}
			{@const active = item.href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(item.href)}
			<a
				href={item.href}
				title={item.label}
				class="relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[0.8125rem] font-medium transition-colors {active
					? 'bg-accent text-foreground shadow-surface'
					: 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'}"
			>
				{#if active}<span class="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary"></span>{/if}
				<item.icon class="size-4 shrink-0" />
				{#if !compact}{item.label}{/if}
			</a>
		{/each}
	</nav>

	{#if !compact}
		<div class="mt-5 flex items-center justify-between px-4 pb-1.5">
			<span class="text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/80 uppercase">Sessions</span>
			{#if !sessions.connected && signedIn}<span class="text-[0.625rem] text-muted-foreground/70" title="Live updates reconnecting">offline</span>{/if}
		</div>
	{:else}
		<div class="mt-4"></div>
	{/if}

	<div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pt-0.5 pb-2">
		{#each ordered as s (s.id)}
			{@const active = page.url.pathname === `/s/${s.id}`}
			{@const view = displayState(s, shown.live[s.id])}
			{@const now = doing(s, view)}
			{@const isPinned = pinned.includes(s.id)}
			<div class="group relative">
				<a
					href="/s/{s.id}"
					title="{s.name} — {repoLabel(s)}"
					class="flex items-center gap-2.5 rounded-lg px-2.5 transition-colors {glowClass(view, { small: true })} {compact ? 'h-8 justify-center' : 'py-1.5 pr-8'} {active
						? 'bg-accent text-foreground'
						: 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'}"
				>
					<StateDot state={view} class={compact ? '' : 'mt-0.5 self-start'} />
					{#if !compact}
						<span class="min-w-0 flex-1">
							<span class="block truncate text-[0.8125rem] {active ? 'font-medium' : ''} {s.status === 'stopped' ? 'opacity-70' : ''}">{s.name}</span>
							<span class="block truncate text-[0.6875rem] {now.tone || 'text-muted-foreground/80'}">{now.text}</span>
						</span>
					{/if}
				</a>
				{#if !compact}
					<button
						type="button"
						class="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground {isPinned ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
						title={isPinned ? 'Unpin' : 'Pin to the top'}
						aria-label={isPinned ? `Unpin ${s.name}` : `Pin ${s.name}`}
						aria-pressed={isPinned}
						onclick={() => togglePin(s.id)}
					>
						{#if isPinned}<PinOff class="size-3.5" />{:else}<Pin class="size-3.5" />{/if}
					</button>
				{/if}
			</div>
		{:else}
			{#if !compact}
				<a href="/new" class="block w-full rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground">
					No sessions yet.<br /><span class="text-primary">Start one →</span>
				</a>
			{/if}
		{/each}
	</div>

	{#if data.viewer && data.auth === 'authenticated' && !compact}
		<a href="/settings#account" title="My account" class="flex items-center gap-2.5 border-t border-border px-3 py-2.5 transition-colors hover:bg-accent/60">
			<span class="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-[0.6875rem] font-semibold text-primary uppercase">
				{(data.viewer.name ?? data.viewer.email).slice(0, 1)}
			</span>
			<div class="min-w-0 flex-1">
				<p class="truncate text-xs font-medium">{data.viewer.name ?? data.viewer.email}</p>
				{#if data.viewer.name}<p class="truncate text-[0.6875rem] text-muted-foreground">{data.viewer.email}</p>{/if}
			</div>
		</a>
	{/if}
	<div class="flex items-center gap-1 border-t border-border p-2 {compact ? 'flex-col' : ''}">
		<button class="btn btn-ghost btn-icon btn-sm max-md:hidden" title="Toggle sidebar (⌘B)" onclick={() => (collapsed = !collapsed)}>
			{#if compact}<PanelLeftOpen />{:else}<PanelLeftClose />{/if}
		</button>
		<button class="btn btn-ghost btn-icon btn-sm" title="Toggle theme" onclick={() => setTheme(theme.value === 'dark' ? 'light' : 'dark')}>
			{#if theme.value === 'dark'}<Sun />{:else}<Moon />{/if}
		</button>
		{#if !compact}
			<span class="ml-1 truncate font-mono text-[0.6875rem] text-muted-foreground/70" title="Orbital version">v{data.version}</span>
		{/if}
		{#if data.auth === 'authenticated'}
			<button class="btn btn-ghost btn-icon btn-sm {compact ? '' : 'ml-auto'}" title="Sign out" onclick={logout}><LogOut /></button>
		{/if}
	</div>
{/snippet}

{#if bare}
	{@render children()}
{:else}
	<div class="flex h-dvh overflow-hidden">
		<aside class="flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 max-md:hidden {collapsed ? 'w-14' : 'w-64'}">
			{@render sidebar(collapsed)}
		</aside>

		{#if drawer}
			<button class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" aria-label="Close menu" onclick={() => (drawer = false)}></button>
			<aside class="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-surface shadow-surface-lg md:hidden">
				{@render sidebar(false)}
			</aside>
		{/if}

		<div class="flex min-w-0 flex-1 flex-col">
			<header class="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:hidden">
				<button class="btn btn-ghost btn-icon btn-sm" aria-label="Menu" onclick={() => (drawer = true)}><Menu /></button>
				<a href="/" class="flex items-center gap-2"><Logo size={22} /><span class="text-sm font-semibold tracking-tight">Orbital</span></a>
				<a href="/new" class="btn btn-ghost btn-icon btn-sm ml-auto" aria-label="New session"><Plus /></a>
			</header>
			<main class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
				{@render children()}
			</main>
		</div>
	</div>
	<!-- ⌘K / Ctrl+K: jump to a session or page. -->
	<CommandPalette />
	<Shortcuts sessions={ordered} />
{/if}

<Toaster />
<ConfirmHost />
