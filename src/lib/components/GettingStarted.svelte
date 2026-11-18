<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowRight, Check, TerminalSquare } from '@lucide/svelte';
	import BrandIcon from '#lib/components/BrandIcon.svelte';
	import { ACCOUNT_KINDS } from '#lib/providers.ts';
	import type { ModelAccount } from '#lib/types.ts';

	/**
	 * The way from a fresh install to a first session: a model account that works, GitHub if
	 * the repos are private, then a session. The step to do now carries the one button that
	 * does it; `compact` is the one-line version for the top of other pages.
	 */
	let {
		accounts,
		signingIn = [],
		githubAccounts,
		compact = false,
		onaddmodel,
		onaddgithub
	}: {
		accounts: Pick<ModelAccount, 'id' | 'name' | 'kind' | 'status'>[];
		/** Accounts whose sign-in container is still waiting. */
		signingIn?: string[];
		githubAccounts: number;
		compact?: boolean;
		/** On the Accounts page, open its dialogs instead of linking there. */
		onaddmodel?: () => void;
		onaddgithub?: () => void;
	} = $props();

	// Skipping GitHub is a choice per browser: public repos need no token.
	const SKIP_KEY = 'orb.skipGithub';
	let skippedGithub = $state(false);
	onMount(() => {
		try {
			skippedGithub = localStorage.getItem(SKIP_KEY) === '1';
		} catch {}
	});
	function skipGithub() {
		skippedGithub = true;
		try {
			localStorage.setItem(SKIP_KEY, '1');
		} catch {}
	}

	// "unknown" is an account nobody has checked yet: let it through, the session will tell.
	const working = $derived(accounts.find((a) => a.status !== 'signed_out'));
	const unfinished = $derived(accounts.find((a) => signingIn.includes(a.id)) ?? accounts[0]);

	type Step = { key: string; done: boolean; title: string; hint: string; action: string; href: string; onclick?: () => void; optional?: boolean };
	const steps = $derived<Step[]>([
		working
			? {
					key: 'model',
					done: true,
					title: 'Model account connected',
					hint: working.status === 'signed_in' ? `${working.name} is ready.` : `${working.name} is added; the first session checks it.`,
					action: '',
					href: '/settings/accounts'
				}
			: unfinished && ACCOUNT_KINDS[unfinished.kind].signIn
				? {
						key: 'model',
						done: false,
						title: `Finish signing in to ${unfinished.name}`,
						hint: 'The account is added but not signed in yet.',
						action: 'Finish signing in',
						href: signingIn.includes(unfinished.id) ? `/settings/accounts?signin=${unfinished.id}` : '/settings/accounts'
					}
				: unfinished
					? {
							key: 'model',
							done: false,
							title: `Fix ${unfinished.name}`,
							hint: "Its check failed: the key or settings don't work yet.",
							action: 'Open Accounts',
							href: '/settings/accounts'
						}
				: {
						key: 'model',
						done: false,
						title: 'Connect a model account',
						hint: 'Your Claude plan or API key, Claude on AWS, Google Cloud or Azure, OpenAI or Gemini.',
						action: 'Add a model account',
						href: '/settings/accounts?add=model',
						onclick: onaddmodel
					},
		{
			key: 'github',
			done: githubAccounts > 0 || skippedGithub,
			title: githubAccounts > 0 ? 'GitHub connected' : skippedGithub ? 'Public repos only' : 'Connect GitHub',
			hint:
				githubAccounts > 0
					? 'Sessions can clone private repos, push and open pull requests.'
					: skippedGithub
						? 'Add a GitHub token on Accounts whenever you need private repos or pull requests.'
						: 'For private repos, pushing and pull requests. Public repos work without it.',
			action: 'Add a GitHub token',
			href: '/settings/accounts?add=github',
			onclick: onaddgithub,
			optional: true
		},
		{ key: 'session', done: false, title: 'Start a session', hint: 'Pick a repo; the agent starts in its own container.', action: 'Start a session', href: '/new' }
	]);
	const current = $derived(steps.find((s) => !s.done) ?? steps[2]);
</script>

{#snippet go(s: Step, primary: boolean)}
	{#if s.onclick}
		<button class="btn {primary ? 'btn-primary' : 'btn-secondary'} btn-sm shrink-0" onclick={s.onclick}>{s.action}<ArrowRight /></button>
	{:else}
		<a class="btn {primary ? 'btn-primary' : 'btn-secondary'} btn-sm shrink-0" href={s.href}>{s.action}<ArrowRight /></a>
	{/if}
{/snippet}

{#if compact}
	<div class="card flex flex-wrap items-center gap-3 border-primary/30 p-4">
		<span class="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{steps.indexOf(current) + 1}</span>
		<div class="min-w-0 flex-1 basis-56">
			<p class="text-[0.8125rem] font-medium">Next: {current.title.charAt(0).toLowerCase() + current.title.slice(1)}</p>
			<p class="text-xs text-muted-foreground">{current.hint}</p>
		</div>
		{#if current.key === 'github'}<button class="btn btn-ghost btn-sm" onclick={skipGithub}>Skip</button>{/if}
		{@render go(current, true)}
	</div>
{:else}
	<section class="card mx-auto max-w-2xl p-6">
		<h2 class="text-[0.9375rem] font-semibold tracking-tight">Get your first session running</h2>
		<p class="mt-1 text-[0.8125rem] text-muted-foreground">Sessions run Claude Code, Codex or Gemini in a container of their own, on a repo you pick.</p>
		<ol class="mt-5 space-y-2">
			{#each steps as s, i (s.key)}
				{@const now = s === current}
				<li class="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 {now ? 'border-primary/40 bg-primary-soft/40' : 'border-border'}">
					<span class="grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold {s.done ? 'bg-success/15 text-success' : now ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}">
						{#if s.done}<Check class="size-3.5" />{:else}{i + 1}{/if}
					</span>
					<span class="min-w-0 flex-1 basis-48">
						<span class="flex items-center gap-2 text-[0.8125rem] font-medium {s.done ? 'text-muted-foreground' : ''}">
							{#if s.key === 'model'}<BrandIcon brand="claude" class="size-3.5" />{:else if s.key === 'github'}<BrandIcon brand="github" class="size-3.5" />{:else}<TerminalSquare class="size-3.5" />{/if}
							{s.title}
							{#if s.optional && !s.done}<span class="badge">Optional</span>{/if}
						</span>
						<span class="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>
					</span>
					{#if now}
						{#if s.key === 'github'}<button class="btn btn-ghost btn-sm" onclick={skipGithub}>Skip</button>{/if}
						{@render go(s, true)}
					{/if}
				</li>
			{/each}
		</ol>
	</section>
{/if}
