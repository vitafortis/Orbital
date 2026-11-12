<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		ArrowRight,
		CircleAlert,
		ExternalLink,
		GitBranch,
		LoaderCircle,
		Pencil,
		Plus,
		RefreshCw,
		Tag,
		Trash2,
		Unplug
	} from '@lucide/svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import BrandIcon from '#lib/components/BrandIcon.svelte';
	import SettingsTabs from '#lib/components/SettingsTabs.svelte';
	import RepoPicker from '#lib/components/RepoPicker.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { ago, githubLabel } from '#lib/client/format.ts';
	import { modelLabel } from '#lib/models.ts';
	import { confirmAction, toast } from '#lib/client/state.svelte.ts';
	import { parseRepo } from '#lib/launch.ts';
	import { matchProfile } from '#lib/profiles.ts';
	import { ACCOUNT_KINDS, AGENT_PERMISSION_MODES } from '#lib/providers.ts';
	import { PERMISSION_MODES, type LinearRule, type LinearTeam, type PermissionMode } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// ── connection ──────────────────────────────────────────────────────

	let key = $state('');
	let connecting = $state(false);
	let checking = $state(false);

	async function connect(e: SubmitEvent) {
		e.preventDefault();
		connecting = true;
		try {
			const info = await api.post<{ organization: string }>('/api/linear/connect', { key });
			key = '';
			toast('success', `Connected to ${info.organization}`);
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't connect Linear", errorMessage(err));
		}
		connecting = false;
	}

	async function disconnect() {
		const ok = await confirmAction({ title: 'Disconnect Linear?', body: 'Rules stay but stop checking for issues until you connect again.', confirmLabel: 'Disconnect', danger: true });
		if (!ok) return;
		await api.del('/api/linear/connect');
		await invalidateAll();
	}

	async function checkNow() {
		checking = true;
		try {
			const r = await api.post<{ started: number }>('/api/linear/check');
			toast('success', r.started ? `Started ${r.started} session${r.started === 1 ? '' : 's'}` : 'No new issues');
			await invalidateAll();
		} catch (err) {
			toast('error', 'Check failed', errorMessage(err));
		}
		checking = false;
	}

	// ── rules ───────────────────────────────────────────────────────────

	type Form = Omit<LinearRule, 'id' | 'createdAt' | 'lastCheckedAt' | 'lastError'> & { pickUpExisting: boolean };

	let editing = $state<LinearRule | 'new' | null>(null);
	let form = $state<Form>(blank());
	let teams = $state<LinearTeam[]>([]);
	let labels = $state<string[]>([]);
	let saving = $state(false);
	let formError = $state('');

	function blank(): Form {
		return {
			name: '',
			teamId: '',
			teamKey: '',
			profileId: data.profiles.length ? 'auto' : null,
			label: 'claude',
			repo: '',
			githubAccountId: data.githubAccounts[0]?.id ?? null,
			baseBranch: null,
			accountId: (data.accounts.find((a) => a.status === 'signed_in') ?? data.accounts[0])?.id ?? '',
			model: null,
			permissionMode: 'acceptEdits',
			prompt: data.defaultPrompt,
			comment: true,
			moveToStarted: true,
			enabled: true,
			pickUpExisting: false
		};
	}

	const ruleMatch = $derived.by(() => {
		const r = parseRepo(form.repo);
		return r ? matchProfile(data.profiles, r.fullName ?? r.url) : null;
	});
	const fixedProfile = $derived(form.profileId && form.profileId !== 'auto' ? (data.profiles.find((p) => p.id === form.profileId) ?? null) : null);
	const ruleAgent = $derived(data.accounts.find((a) => a.id === form.accountId)?.agent ?? 'claude');
	const ruleModes = $derived(PERMISSION_MODES.filter((m) => AGENT_PERMISSION_MODES[ruleAgent].includes(m.value)));

	function ruleSummary(rule: LinearRule): string {
		const profile = rule.profileId && rule.profileId !== 'auto' ? data.profiles.find((p) => p.id === rule.profileId) : null;
		if (profile) return `Profile ${profile.name}`;
		const own = `${accountName(rule.accountId)} · ${PERMISSION_MODES.find((m) => m.value === rule.permissionMode)?.label} permissions${rule.model ? ` · ${modelLabel(rule.model)}` : ''}`;
		return rule.profileId === 'auto' ? `The repo's profile, else ${own}` : `As ${own}`;
	}

	async function openRule(rule: LinearRule | 'new') {
		editing = rule;
		formError = '';
		form = rule === 'new' ? blank() : { ...rule, pickUpExisting: false };
		try {
			teams = await api.get<LinearTeam[]>('/api/linear/teams');
			if (!form.teamId && teams[0]) form.teamId = teams[0].id;
		} catch (err) {
			formError = errorMessage(err);
		}
	}

	$effect(() => {
		const team = form.teamId;
		if (!editing || !team) return;
		form.teamKey = teams.find((t) => t.id === team)?.key ?? form.teamKey;
		api.get<string[]>(`/api/linear/labels?team=${team}`).then(
			(l) => (labels = l),
			() => {}
		);
	});

	async function saveRule(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		formError = '';
		try {
			if (editing === 'new') await api.post('/api/linear/rules', form);
			else if (editing) await api.put(`/api/linear/rules/${editing.id}`, form);
			editing = null;
			await invalidateAll();
		} catch (err) {
			formError = errorMessage(err);
		}
		saving = false;
	}

	async function toggle(rule: LinearRule, enabled: boolean) {
		await api.put(`/api/linear/rules/${rule.id}`, { ...rule, enabled }).catch((err) => toast('error', "Couldn't update the rule", errorMessage(err)));
		await invalidateAll();
	}

	async function removeRule(rule: LinearRule) {
		const ok = await confirmAction({ title: `Delete “${rule.name}”?`, body: 'Sessions it started keep running.', confirmLabel: 'Delete rule', danger: true });
		if (!ok) return;
		await api.del(`/api/linear/rules/${rule.id}`);
		await invalidateAll();
	}

	const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? 'missing account';
	const ruleName = (id: string) => data.rules.find((r) => r.id === id)?.name ?? '';
</script>

<svelte:head><title>Automations · Orbital</title></svelte:head>

<div class="h-full overflow-y-auto">
	<SettingsTabs admin={data.viewer?.admin ?? false} description="Start sessions from Linear issues: label an issue, and an agent picks it up on its own branch." />

	<div class="max-w-4xl space-y-8 px-4 pb-12 sm:px-8">
		<section class="card p-5">
			<div class="flex flex-wrap items-start gap-4">
				<span class="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface"><BrandIcon brand="linear" class="size-5" /></span>
				<div class="min-w-0 flex-1 basis-52">
					<h2 class="text-[0.9375rem] font-semibold tracking-tight">Linear</h2>
					{#if data.linear.connected}
						<p class="text-xs text-muted-foreground">Connected to <b class="font-medium text-foreground">{data.linear.organization}</b> as {data.linear.viewer}. Rules are checked every minute.</p>
					{:else}
						<p class="text-xs text-muted-foreground">
							Paste a personal API key (Linear → Settings → Security &amp; access → Personal API keys). Orbital asks Linear for new issues every minute, so nothing on your network has to be reachable
							from outside.
						</p>
					{/if}
				</div>
				{#if data.linear.connected}
					<div class="ml-auto flex gap-2">
						<button class="btn btn-secondary btn-sm" disabled={checking} onclick={checkNow}>{#if checking}<LoaderCircle class="animate-spin" />{:else}<RefreshCw />{/if}Check now</button>
						<button class="btn btn-ghost btn-sm" onclick={disconnect}><Unplug />Disconnect</button>
					</div>
				{/if}
			</div>
			{#if !data.linear.connected}
				<form class="mt-4 flex flex-wrap gap-2" onsubmit={connect}>
					<input class="input min-w-60 flex-1 font-mono text-xs" type="password" autocomplete="off" placeholder="lin_api_…" bind:value={key} required />
					<button class="btn btn-primary" disabled={connecting}>{#if connecting}<LoaderCircle class="animate-spin" />{/if}Connect</button>
					<a class="btn btn-ghost" href="https://linear.app/settings/account/security" target="_blank" rel="noopener"><ExternalLink />Get a key</a>
				</form>
			{/if}
		</section>

		<section>
			<div class="mb-3 flex items-end justify-between gap-3">
				<div>
					<h2 class="text-[0.9375rem] font-semibold tracking-tight">Rules</h2>
					<p class="text-xs text-muted-foreground">Each new issue that matches a rule gets its own session, on Linear's branch name for it, so the pull request links back.</p>
				</div>
				<button class="btn btn-secondary btn-sm" disabled={!data.linear.connected || !data.accounts.length} onclick={() => openRule('new')}><Plus />Add rule</button>
			</div>
			<div class="space-y-3">
				{#each data.rules as rule (rule.id)}
					<div class="card flex flex-wrap items-center gap-4 p-4 {rule.enabled ? '' : 'opacity-70'}">
						<div class="min-w-0 flex-1 basis-52">
							<p class="text-[0.8125rem] font-medium">{rule.name}</p>
							<p class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
								Issues in <span class="badge">{rule.teamKey}</span> labelled <span class="badge badge-primary"><Tag />{rule.label}</span>
								<ArrowRight class="size-3" />
								<span class="font-mono text-foreground">{rule.repo}</span>{#if rule.baseBranch}<GitBranch class="size-3" /><span class="font-mono">{rule.baseBranch}</span>{/if}
							</p>
							<p class="mt-1 text-[0.6875rem] text-muted-foreground">
								{ruleSummary(rule)}
								{#if rule.comment} · comments on the issue{/if}{#if rule.moveToStarted} · moves it to In Progress{/if}
								{#if rule.lastCheckedAt} · checked {ago(rule.lastCheckedAt)}{/if}
							</p>
							{#if rule.lastError}<p class="mt-1 flex items-center gap-1.5 text-xs text-danger"><CircleAlert class="size-3.5" />{rule.lastError}</p>{/if}
						</div>
						<div class="ml-auto flex items-center gap-1">
							<Switch checked={rule.enabled} label="Enabled" onchange={(v) => toggle(rule, v)} />
							<button class="btn btn-ghost btn-icon btn-sm" title="Edit" onclick={() => openRule(rule)}><Pencil /></button>
							<button class="btn btn-ghost btn-icon btn-sm hover:text-danger" title="Delete" onclick={() => removeRule(rule)}><Trash2 /></button>
						</div>
					</div>
				{:else}
					<div class="card">
						{#if !data.linear.connected}
							<EmptyState title="Connect Linear to add rules" body="A rule starts a session when an issue gets a label: Claude works on it, comments on the issue and opens the pull request." />
						{:else if !data.accounts.length}
							<EmptyState title="Add a model account first" body="Rules start sessions as one of your model accounts.">
								{#snippet action()}<a class="btn btn-primary btn-sm" href="/settings/accounts?add=model">Add a model account</a>{/snippet}
							</EmptyState>
						{:else}
							<EmptyState title="No rules yet" body="Add one, then label an issue in Linear: a session starts on it within a minute.">
								{#snippet action()}<button class="btn btn-primary btn-sm" onclick={() => openRule('new')}><Plus />Add a rule</button>{/snippet}
							</EmptyState>
						{/if}
					</div>
				{/each}
			</div>
		</section>

		{#if data.runs.length}
			<section>
				<h2 class="mb-3 text-[0.9375rem] font-semibold tracking-tight">Recent issues</h2>
				<div class="card divide-y divide-border">
					{#each data.runs as run (run.ruleId + run.issueId)}
						<div class="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[0.8125rem]">
							<a class="badge hover:text-foreground" href={run.url} target="_blank" rel="noopener"><BrandIcon brand="linear" class="size-3" />{run.identifier}</a>
							<span class="min-w-0 flex-1 truncate">{run.title}</span>
							<span class="text-xs text-muted-foreground">{ruleName(run.ruleId)}</span>
							{#if run.status === 'error'}
								<span class="badge badge-danger" title={run.error ?? ''}>Failed</span>
							{:else if run.sessionId && data.sessionNames[run.sessionId]}
								<a class="btn btn-ghost btn-sm" href="/s/{run.sessionId}">Open session<ArrowRight /></a>
							{:else}
								<span class="text-xs text-muted-foreground">session deleted</span>
							{/if}
							<span class="w-16 text-right text-xs text-muted-foreground">{ago(run.createdAt)}</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	</div>
</div>

<Dialog bind:open={() => !!editing, (v) => !v && (editing = null)} title={editing === 'new' ? 'Add a rule' : 'Edit rule'} width="max-w-2xl">
	<form id="rule" class="space-y-4" onsubmit={saveRule}>
		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label class="label" for="team">Linear team</label>
				<select id="team" class="input" bind:value={form.teamId} required>
					{#each teams as t (t.id)}<option value={t.id}>{t.name} ({t.key})</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="label">When an issue has the label</label>
				<input id="label" class="input" list="linear-labels" bind:value={form.label} required />
				<datalist id="linear-labels">{#each labels as l (l)}<option value={l}></option>{/each}</datalist>
			</div>
		</div>
		<div class="grid gap-4 sm:grid-cols-[12rem_1fr]">
			<div>
				<label class="label flex items-center gap-1.5" for="rgh"><BrandIcon brand="github" class="size-3.5" />GitHub account</label>
				<select id="rgh" class="input" bind:value={form.githubAccountId}>
					{#each data.githubAccounts as a (a.id)}<option value={a.id}>{githubLabel(a)}</option>{/each}
					<option value={null}>None (public repo)</option>
				</select>
			</div>
			<div>
				<span class="label">Start a session on</span>
				<RepoPicker logins={[...new Set(data.githubAccounts.map((a) => a.login))]} bind:value={form.repo} onpick={() => {}} />
			</div>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label class="label" for="rbase">From branch</label>
				<input id="rbase" class="input font-mono text-xs" placeholder="Default branch" value={form.baseBranch ?? ''} oninput={(e) => (form.baseBranch = e.currentTarget.value || null)} />
			</div>
			<div>
				<label class="label" for="rprofile">Profile</label>
				<select id="rprofile" class="input" bind:value={form.profileId}>
					<option value={null}>None: use the account below</option>
					<option value="auto">Match the repo{ruleMatch ? ` (now: ${ruleMatch.name})` : ''}</option>
					{#each data.profiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</div>
		</div>
		{#if !fixedProfile}
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="label" for="racct">{form.profileId === 'auto' ? 'Account if no profile matches' : 'Account'}</label>
					<select id="racct" class="input" bind:value={form.accountId} required>
						{#each data.accounts as a (a.id)}<option value={a.id}>{a.name} · {ACCOUNT_KINDS[a.kind].label}</option>{/each}
					</select>
				</div>
				<div>
					<label class="label" for="rperm">Permissions</label>
					<select id="rperm" class="input" bind:value={form.permissionMode}>
						{#each ruleModes as m (m.value)}<option value={m.value as PermissionMode}>{m.label}</option>{/each}
					</select>
				</div>
			</div>
		{:else}
			<p class="-mt-1 text-xs text-muted-foreground">Sessions use {fixedProfile.name}'s account, model and permissions.</p>
		{/if}
		<div>
			<label class="label flex items-center justify-between" for="rprompt">
				<span>First message</span>
				<button type="button" class="text-primary hover:underline" onclick={() => (form.prompt = data.defaultPrompt)}>Reset</button>
			</label>
			<textarea id="rprompt" class="input h-auto min-h-36 py-2 font-mono text-xs leading-relaxed" rows="8" bind:value={form.prompt}></textarea>
			<p class="mt-1.5 text-xs text-muted-foreground">
				Filled in per issue: <code class="font-mono">{'{identifier}'}</code> <code class="font-mono">{'{title}'}</code> <code class="font-mono">{'{description}'}</code>
				<code class="font-mono">{'{url}'}</code> <code class="font-mono">{'{branch}'}</code>. Start it with a skill, e.g. <code class="font-mono">/my-skill {'{identifier}'}</code>, to run one.
			</p>
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			<label class="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[0.8125rem]">
				Comment on the issue <Switch bind:checked={form.comment} label="Comment on the issue" />
			</label>
			<label class="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[0.8125rem]">
				Move it to In Progress <Switch bind:checked={form.moveToStarted} label="Move to In Progress" />
			</label>
			{#if editing === 'new'}
				<label class="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[0.8125rem] sm:col-span-2">
					<span>Also start sessions for issues that already have the label <span class="block text-xs text-muted-foreground">Off: only issues labelled from now on.</span></span>
					<Switch bind:checked={form.pickUpExisting} label="Pick up existing issues" />
				</label>
			{/if}
		</div>
		<div>
			<label class="label" for="rname">Rule name <span class="font-normal text-muted-foreground/70">(optional)</span></label>
			<input id="rname" class="input" placeholder="Team · label" bind:value={form.name} />
		</div>
		{#if formError}<p class="text-xs text-danger">{formError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (editing = null)}>Cancel</button>
		<button class="btn btn-primary" form="rule" disabled={saving}>{#if saving}<LoaderCircle class="animate-spin" />{/if}Save rule</button>
	{/snippet}
</Dialog>
