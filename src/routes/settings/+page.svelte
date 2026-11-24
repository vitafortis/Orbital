<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Box, CircleCheck, CircleX, Container, Download, HardDrive, LoaderCircle, Save } from '@lucide/svelte';
	import AskAccess from '#lib/components/AskAccess.svelte';
	import { ROLE_LABEL } from '#lib/access.ts';
	import BrandIcon from '#lib/components/BrandIcon.svelte';
	import SettingsTabs from '#lib/components/SettingsTabs.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import ModelPicker from '#lib/components/ModelPicker.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { ago } from '#lib/client/format.ts';
	import { confirmAction, toast } from '#lib/client/state.svelte.ts';
	import { PERMISSION_MODES, type Settings } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Status = {
		docker: { ok: true; version: string; api: string; os: string; arch: string } | { ok: false; error: string };
		storage: ({ ok: true } & ({ kind: 'volume'; name: string } | { kind: 'bind'; hostPath: string })) | { ok: false; error: string };
		image: { ok: boolean; ref: string; created: string | null; error?: string };
		sessionsDir: string;
		dockerHost: string;
	};

	let status = $state<Status | null>(null);
	// Form fields start from the loaded values and are edited locally.
	let form = $state<Settings>(untrack(() => ({ ...data.settings })));
	let saving = $state(false);
	let pulling = $state(false);

	let name = $state(untrack(() => data.account?.name ?? ''));
	let email = $state(untrack(() => data.account?.email ?? ''));
	let currentPassword = $state('');
	let newPassword = $state('');
	let savingAccount = $state(false);

	async function loadStatus() {
		status = await api.get<Status>('/api/status');
	}
	// Docker and the session image: the organization's, for admins.
	onMount(() => {
		if (data.admin) void loadStatus();
		// Back from linking single sign-on.
		if (new URLSearchParams(location.search).get('sso') === 'linked') {
			toast('success', 'Linked your single sign-on', 'You can sign in with it from now on.');
			history.replaceState(history.state, '', location.pathname + location.hash);
		}
	});

	// A GitHub App's client secret: sent only when typed, never shown again.
	let clientSecret = $state('');
	async function forgetClientSecret() {
		try {
			const r = await api.put<{ settings: Settings }>('/api/settings', { ...form, githubClientSecret: null });
			form = { ...r.settings };
		} catch (err) {
			toast('error', "Couldn't remove it", errorMessage(err));
		}
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		try {
			const r = await api.put<{ settings: Settings }>('/api/settings', { ...form, ...(clientSecret.trim() ? { githubClientSecret: clientSecret.trim() } : {}) });
			form = { ...r.settings };
			clientSecret = '';
			toast('success', 'Settings saved', 'New and restarted sessions use them.');
			void loadStatus();
		} catch (err) {
			toast('error', "Couldn't save", errorMessage(err));
		}
		saving = false;
	}

	async function pull() {
		pulling = true;
		try {
			await api.post('/api/settings/image');
			toast('success', 'Pulled the session image', 'Sessions use it from their next start.');
			await loadStatus();
		} catch (err) {
			toast('error', "Couldn't pull the image", errorMessage(err));
		}
		pulling = false;
	}

	async function unlinkSso() {
		const ok = await confirmAction({ title: 'Unlink single sign-on?', body: 'You sign in with your password from then on. Signing in with SSO again links it back.', confirmLabel: 'Unlink' });
		if (!ok) return;
		try {
			await api.put('/api/account', { unlinkSso: true });
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't unlink it", errorMessage(err));
		}
	}

	async function saveAccount(e: SubmitEvent) {
		e.preventDefault();
		savingAccount = true;
		try {
			await api.put('/api/account', { name, email, currentPassword, newPassword });
			toast('success', 'Account updated');
			currentPassword = newPassword = '';
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't update your account", errorMessage(err));
		}
		savingAccount = false;
	}
</script>

<svelte:head><title>Settings · Orbital</title></svelte:head>

{#snippet check(ok: boolean | undefined)}
	{#if ok === undefined}<LoaderCircle class="size-4 animate-spin text-muted-foreground" />{:else if ok}<CircleCheck class="size-4 text-success" />{:else}<CircleX class="size-4 text-danger" />{/if}
{/snippet}

<div class="h-full overflow-y-auto">
	<SettingsTabs admin={data.admin} description={data.admin ? 'Where sessions run, and what every session container gets.' : 'Your name, email and password, and your role.'} />

	<div class="max-w-4xl space-y-8 px-4 pt-6 pb-12 sm:px-8">
		<!-- Where sessions run and what they get: the organization's, for admins. -->
		{#if data.admin}
		<section class="grid gap-3 md:grid-cols-3">
			<div class="card p-4">
				<p class="flex items-center gap-2 text-[0.8125rem] font-medium"><Container class="size-4 text-muted-foreground" />Docker {@render check(status?.docker.ok)}</p>
				{#if status?.docker.ok}
					<p class="mt-1.5 text-xs text-muted-foreground">Engine {status.docker.version} · API {status.docker.api} · {status.docker.arch}</p>
				{:else if status && 'error' in status.docker}
					<p class="mt-1.5 text-xs text-danger">{status.docker.error}</p>
				{/if}
				{#if status}<p class="mt-1 truncate font-mono text-[0.6875rem] text-muted-foreground" title={status.dockerHost}>{status.dockerHost}</p>{/if}
			</div>
			<div class="card p-4">
				<p class="flex items-center gap-2 text-[0.8125rem] font-medium"><HardDrive class="size-4 text-muted-foreground" />Session storage {@render check(status?.storage.ok)}</p>
				{#if status?.storage.ok}
					<p class="mt-1.5 text-xs text-muted-foreground">
						{#if status.storage.kind === 'volume'}Volume <span class="font-mono">{status.storage.name}</span>{:else}Host folder <span class="font-mono break-all">{status.storage.hostPath}</span>{/if}
					</p>
				{:else if status && 'error' in status.storage}
					<p class="mt-1.5 text-xs text-danger">{status.storage.error}</p>
				{/if}
				{#if status && !(status.storage.ok && status.storage.kind === 'bind' && status.storage.hostPath === status.sessionsDir)}
					<p class="mt-1 font-mono text-[0.6875rem] break-all text-muted-foreground">Mounted at {status.sessionsDir}</p>
				{/if}
			</div>
			<div class="card p-4">
				<p class="flex items-center gap-2 text-[0.8125rem] font-medium"><Box class="size-4 text-muted-foreground" />Session image {@render check(status ? status.image.ok : undefined)}</p>
				{#if status}
					<p class="mt-1.5 text-xs text-muted-foreground">{status.image.created ? `Built ${ago(status.image.created)}` : status.image.error ?? 'Not pulled yet (pulled on first start)'}</p>
				{/if}
				<button class="btn btn-secondary btn-sm mt-2.5" disabled={pulling || !status?.docker.ok} onclick={pull}>
					{#if pulling}<LoaderCircle class="animate-spin" />{:else}<Download />{/if}Pull latest
				</button>
			</div>
		</section>

		<form class="card space-y-5 p-5" onsubmit={save}>
			<div>
				<h2 class="text-[0.9375rem] font-semibold tracking-tight">Session containers</h2>
				<p class="text-xs text-muted-foreground">Apply to sessions started (or restarted) after saving.</p>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="sm:col-span-2">
					<label class="label" for="img">Image</label>
					<input id="img" class="input font-mono text-xs" bind:value={form.sessionImage} />
					<p class="mt-1.5 text-xs text-muted-foreground">Build your own from <code class="font-mono">session/Dockerfile</code> to add languages and tools.</p>
				</div>
				<div class="sm:col-span-2">
					<label class="label" for="img-all">Image for Codex and Gemini sessions</label>
					<input id="img-all" class="input font-mono text-xs" bind:value={form.agentsImage} />
					<p class="mt-1.5 text-xs text-muted-foreground">The same image with Codex CLI and Gemini CLI added (<code class="font-mono">AGENTS="claude codex gemini"</code>). Pulled the first time an OpenAI or Google account is used.</p>
				</div>
				<div>
					<label class="label" for="net">Docker network</label>
					<input id="net" class="input font-mono text-xs" placeholder="Default bridge" bind:value={form.network} />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="label" for="mem">Memory (MB)</label>
						<input id="mem" class="input" type="number" min="0" placeholder="No limit" bind:value={form.memoryMb} />
					</div>
					<div>
						<label class="label" for="cpu">CPUs</label>
						<input id="cpu" class="input" type="number" min="0" step="0.5" placeholder="No limit" bind:value={form.cpus} />
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3 sm:col-span-2">
					<div>
						<label class="label" for="idle">Stop idle sessions after (hours)</label>
						<input id="idle" class="input" type="number" min="0" step="0.5" placeholder="Never" bind:value={form.idleStopHours} />
						<p class="mt-1 text-xs text-muted-foreground">No new conversation and nothing typed in its terminals for this long. A session whose agent is working is never idle.</p>
					</div>
					<div>
						<label class="label" for="del">Delete stopped sessions after (days)</label>
						<input id="del" class="input" type="number" min="0" step="0.5" placeholder="Never" bind:value={form.deleteStoppedDays} />
						<p class="mt-1 text-xs text-muted-foreground">With their clone, home folder and conversations; pushed commits stay on GitHub. 0: never.</p>
					</div>
				</div>
				<div>
					<label class="label" for="dm">Default model</label>
					<ModelPicker id="dm" bind:value={form.defaultModel} agent="claude" />
				</div>
				<div>
					<label class="label" for="dp">Default permissions</label>
					<select id="dp" class="input" bind:value={form.defaultPermissionMode}>
						{#each PERMISSION_MODES as m (m.value)}<option value={m.value}>{m.label} — {m.hint}</option>{/each}
					</select>
				</div>
				<div class="flex items-center justify-between gap-3 sm:col-span-2">
					<span>
						<span class="block text-[0.8125rem] font-medium">Remote Control for new sessions</span>
						<span class="block text-xs text-muted-foreground">On by default for subscription accounts; each session can turn it off.</span>
					</span>
					<Switch bind:checked={form.defaultRemoteControl} label="Remote Control by default" />
				</div>
				<div class="sm:col-span-2">
					<label class="label" for="pub">Public URL</label>
					<input id="pub" class="input font-mono text-xs" placeholder="Where you open Orbital, e.g. https://cc.home.arpa" bind:value={form.publicUrl} />
					<p class="mt-1.5 text-xs text-muted-foreground">Used for links in Linear comments and the SSO callback. Empty: the address you last opened Orbital at.</p>
				</div>
				<div class="sm:col-span-2">
					<label class="label flex items-center gap-1.5" for="ghc"><BrandIcon brand="github" class="size-3.5" />GitHub sign-in <span class="font-normal text-muted-foreground">· optional</span></label>
					<div class="grid gap-2 sm:grid-cols-2">
						<input id="ghc" class="input font-mono text-xs" placeholder="Client ID, e.g. Ov23li… or Iv23li…" bind:value={form.githubClientId} />
						<div class="flex gap-2">
							<input class="input font-mono text-xs" type="password" autocomplete="off" aria-label="Client secret" placeholder={form.githubClientSecretSet ? 'Client secret saved. Type to replace' : 'Client secret (GitHub Apps)'} bind:value={clientSecret} />
							{#if form.githubClientSecretSet}<button type="button" class="btn btn-ghost btn-sm shrink-0" onclick={forgetClientSecret}>Remove</button>{/if}
						</div>
					</div>
					<p class="mt-1.5 text-xs text-muted-foreground">
						Adds <b class="font-medium text-foreground">Sign in with GitHub</b> under Accounts: sessions act as the person who signs in. Use an OAuth app, or a <b class="font-medium text-foreground">GitHub App</b> where personal tokens aren't allowed, with <i>Enable Device Flow</i> checked; no callback URL needed. A GitHub App's sign-ins expire after 8 hours: give its client secret and Orbital renews them. To act as the app itself instead, add it under Accounts → GitHub.
					</p>
				</div>
				<div class="sm:col-span-2">
					<label class="label" for="env">Extra environment</label>
					<textarea id="env" class="input h-auto min-h-24 py-2 font-mono text-xs" rows="4" placeholder={'# KEY=value, one per line\nNPM_CONFIG_REGISTRY=https://npm.lan'} bind:value={form.extraEnv}></textarea>
				</div>
			</div>
			<div class="flex justify-end">
				<button class="btn btn-primary" disabled={saving}>{#if saving}<LoaderCircle class="animate-spin" />{:else}<Save />{/if}Save</button>
			</div>
		</form>
		{/if}

		{#if data.account}
			<form id="account" class="card space-y-4 p-5" onsubmit={saveAccount}>
				<h2 class="text-[0.9375rem] font-semibold tracking-tight">Your account</h2>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="label" for="an">Name</label>
						<input id="an" class="input" bind:value={name} />
					</div>
					<div>
						<label class="label" for="ae">Email</label>
						<input id="ae" class="input" type="email" bind:value={email} disabled={data.account.ssoLinked} />
					</div>
					{#if data.account.hasPassword || !data.sso.ssoOnly || data.admin}
					{#if data.account.hasPassword}
					<div>
						<label class="label" for="cp">Current password</label>
						<input id="cp" class="input" type="password" autocomplete="current-password" bind:value={currentPassword} />
					</div>
					{/if}
					<div>
						<label class="label" for="np">{data.account.hasPassword ? 'New password' : 'Password'}</label>
						<input id="np" class="input" type="password" autocomplete="new-password" placeholder={data.account.hasPassword ? 'Leave empty to keep' : 'Set one to also sign in without SSO'} bind:value={newPassword} />
					</div>
					{/if}
					<!-- How you sign in: a password, single sign-on, or both. -->
					<div class="space-y-1.5 text-xs sm:col-span-2">
						<p class="font-medium text-foreground">Sign-in methods</p>
						<p class="flex flex-wrap items-center gap-2 text-muted-foreground">
							<span class="badge {data.account.hasPassword ? 'badge-success' : ''}">Password: {data.account.hasPassword ? 'set' : 'none'}</span>
							<span class="badge {data.account.ssoLinked ? 'badge-success' : ''}">Single sign-on: {data.account.ssoLinked ? 'linked' : 'not linked'}</span>
							{#if !data.account.ssoLinked && data.sso.oidc}<a class="font-medium text-primary hover:underline" href="/api/auth/oidc/start?link=1" data-sveltekit-reload>Link my single sign-on</a>{/if}
							{#if data.account.ssoLinked && data.account.hasPassword}<button type="button" class="font-medium text-primary hover:underline" onclick={unlinkSso}>Unlink</button>{/if}
						</p>
						{#if data.account.ssoLinked}<p class="text-muted-foreground">Your email follows your single sign-on account: change it there.</p>{/if}
						{#if data.sso.ssoOnly && !data.admin}<p class="text-muted-foreground">Orbital signs people in through single sign-on, so a password isn't used for you.</p>{/if}
					</div>
				</div>
				<div class="flex justify-end">
					<button class="btn btn-secondary" disabled={savingAccount}>{#if savingAccount}<LoaderCircle class="animate-spin" />{/if}Update account</button>
				</div>
			</form>
			{#if !data.viewer?.admin || data.viewer.tempUntil}
				<div class="card flex flex-wrap items-center gap-3 p-5 text-[0.8125rem]">
					<p class="font-medium">Your role: {ROLE_LABEL[data.viewer?.role ?? 'viewer']}</p>
					<div class="text-xs text-muted-foreground"><AskAccess /></div>
				</div>
			{/if}
		{/if}
	</div>
</div>
