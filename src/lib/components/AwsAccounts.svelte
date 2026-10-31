<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { ExternalLink, FlaskConical, LoaderCircle, Pencil, Plus, RotateCcw, ShieldCheck, Trash2 } from '@lucide/svelte';
	import BrandIcon from '#lib/components/BrandIcon.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { copyText } from '#lib/client/clipboard.ts';
	import { confirmAction, toast } from '#lib/client/state.svelte.ts';
	import type { AwsLogin, AwsProfile } from '#lib/types.ts';

	/**
	 * AWS access through IAM Identity Center: sign-ins (kept on the server) and the profiles
	 * sessions can be given, one account and role each. Only admins change them.
	 */
	let { logins, profiles, admin }: { logins: AwsLogin[]; profiles: AwsProfile[]; admin: boolean } = $props();

	const loginName = (l: AwsLogin) => l.label ?? new URL(l.startUrl).hostname;
	const loginById = $derived(new Map(logins.map((l) => [l.id, l])));
	const ended = (l: AwsLogin) => !l.renewable && !!l.expiresAt && Date.parse(l.expiresAt) < Date.now();

	// ── signing in ──
	let signingIn = $state(false);
	let form = $state({ startUrl: '', ssoRegion: 'us-east-1', label: '' });
	let busy = $state(false);
	let formError = $state('');
	let device = $state<{ handle: string; userCode: string; verificationUri: string; interval: number } | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(timer));

	function openSignIn(again?: AwsLogin) {
		form = again ? { startUrl: again.startUrl, ssoRegion: again.ssoRegion, label: again.label ?? '' } : { startUrl: '', ssoRegion: 'us-east-1', label: '' };
		formError = '';
		signingIn = true;
	}

	async function startSignIn(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		formError = '';
		try {
			device = await api.post('/api/aws/logins', form);
			signingIn = false;
			poll();
		} catch (err) {
			formError = errorMessage(err);
		}
		busy = false;
	}

	function poll() {
		if (!device) return;
		timer = setTimeout(async () => {
			if (!device) return;
			try {
				const r = await api.post<{ state: string; login?: AwsLogin; interval?: number }>('/api/aws/logins/poll', { handle: device.handle });
				if (r.state === 'pending') {
					device.interval = r.interval ?? device.interval;
					poll();
					return;
				}
				if (r.state === 'done' && r.login) {
					toast('success', `Signed in to ${loginName(r.login)}`);
					await invalidateAll();
				} else toast('error', r.state === 'denied' ? 'The AWS sign-in was declined' : 'The code expired. Try again.');
			} catch (err) {
				toast('error', 'AWS sign-in failed', errorMessage(err));
			}
			device = null;
		}, device.interval * 1000);
	}

	async function removeLogin(l: AwsLogin) {
		const mine = profiles.filter((p) => p.loginId === l.id);
		const ok = await confirmAction({
			title: `Remove the sign-in to ${loginName(l)}?`,
			body: mine.length ? `Its profiles go too, and sessions using them lose their AWS credentials at once: ${mine.map((p) => p.name).join(', ')}.` : 'Orbital forgets its token.',
			confirmLabel: 'Remove',
			danger: true
		});
		if (!ok) return;
		try {
			await api.del(`/api/aws/logins/${l.id}`);
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't remove it", errorMessage(err));
		}
	}

	// ── profiles ──
	let editing = $state<AwsProfile | null>(null);
	let profileOpen = $state(false);
	let pf = $state({ name: '', loginId: '', accountId: '', accountName: '', roleName: '', region: '' });
	let accounts = $state<{ accountId: string; accountName: string | null }[]>([]);
	let roles = $state<string[]>([]);
	let loading = $state('');
	let profileError = $state('');
	let nameTouched = false;

	function openProfile(p: AwsProfile | null) {
		editing = p;
		nameTouched = !!p;
		const login = p ? loginById.get(p.loginId) : logins[0];
		pf = p
			? { name: p.name, loginId: p.loginId, accountId: p.accountId, accountName: p.accountName ?? '', roleName: p.roleName, region: p.region }
			: { name: '', loginId: login?.id ?? '', accountId: '', accountName: '', roleName: '', region: login?.ssoRegion ?? 'us-east-1' };
		profileError = '';
		accounts = [];
		roles = [];
		profileOpen = true;
		void loadAccounts();
	}

	async function loadAccounts() {
		if (!pf.loginId) return;
		loading = 'accounts';
		try {
			accounts = await api.get(`/api/aws/logins/${pf.loginId}/accounts`);
			if (pf.accountId) await loadRoles();
		} catch (err) {
			profileError = errorMessage(err);
		}
		loading = '';
	}

	async function loadRoles() {
		roles = [];
		if (!pf.accountId) return;
		loading = 'roles';
		try {
			roles = await api.get(`/api/aws/logins/${pf.loginId}/roles?account=${pf.accountId}`);
			if (roles.length === 1 && !pf.roleName) pf.roleName = roles[0];
			suggestName();
		} catch (err) {
			profileError = errorMessage(err);
		}
		loading = '';
	}

	// prod + ReadOnlyAccess → prod-readonlyaccess, until typed by hand.
	function suggestName() {
		if (nameTouched || !pf.accountId || !pf.roleName) return;
		const acct = accounts.find((a) => a.accountId === pf.accountId)?.accountName ?? pf.accountId;
		pf.name = `${acct}-${pf.roleName}`
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 63);
	}

	async function saveProfile(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		profileError = '';
		const body = { ...pf, accountName: accounts.find((a) => a.accountId === pf.accountId)?.accountName ?? (pf.accountName || null) };
		try {
			if (editing) await api.patch(`/api/aws/profiles/${editing.id}`, body);
			else await api.post('/api/aws/profiles', body);
			profileOpen = false;
			await invalidateAll();
		} catch (err) {
			profileError = errorMessage(err);
		}
		busy = false;
	}

	async function removeProfile(p: AwsProfile) {
		const ok = await confirmAction({
			title: `Remove the profile ${p.name}?`,
			body: 'Sessions using it lose these AWS credentials at once.',
			confirmLabel: 'Remove',
			danger: true
		});
		if (!ok) return;
		try {
			await api.del(`/api/aws/profiles/${p.id}`);
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't remove it", errorMessage(err));
		}
	}

	let testing = $state<string | null>(null);
	async function test(p: AwsProfile) {
		testing = p.id;
		try {
			const r = await api.post<{ expiresAt: string }>(`/api/aws/profiles/${p.id}/test`);
			toast('success', `${p.name} works`, `AWS issued credentials for ${p.roleName}, good until ${new Date(r.expiresAt).toLocaleTimeString()}.`);
		} catch (err) {
			toast('error', `${p.name} doesn't work`, errorMessage(err));
		}
		testing = null;
	}
</script>

<section id="aws">
	<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight"><BrandIcon brand="bedrock" />AWS</h2>
			<p class="max-w-2xl text-xs text-muted-foreground">
				For the AWS CLI, SDKs and Terraform in sessions, through IAM Identity Center (SSO). A session gets only the profiles it's given: short-lived keys for one account and role each, renewed while it runs. Your sign-in stays here.
			</p>
		</div>
		{#if admin}
			<div class="flex gap-2">
				<button class="btn btn-secondary btn-sm" onclick={() => openSignIn()}><BrandIcon brand="bedrock" class="size-4" />Sign in to AWS SSO</button>
				<button class="btn btn-secondary btn-sm" disabled={!logins.length} onclick={() => openProfile(null)}><Plus />Add a profile</button>
			</div>
		{/if}
	</div>

	<div class="card divide-y divide-border">
		{#each logins as l (l.id)}
			<div class="flex flex-wrap items-center gap-3 px-4 py-3">
				<div class="min-w-0 flex-1 basis-52">
					<p class="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium">
						{loginName(l)}<span class="truncate font-mono text-[0.6875rem] font-normal text-muted-foreground">{l.startUrl}</span>
						{#if ended(l)}<span class="badge badge-danger">Signed out</span>{:else}<span class="badge">SSO · {l.ssoRegion}</span>{/if}
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						{#if ended(l)}The sign-in ended: sessions keep their keys until they expire, then get no new ones until someone signs in again.
						{:else if l.renewable}Renews itself, within the session length your Identity Center allows.
						{:else if l.expiresAt}Good until {new Date(l.expiresAt).toLocaleString()}; sign in again after that.{/if}
					</p>
				</div>
				{#if admin}
					<div class="ml-auto flex items-center gap-1">
						<button class="btn btn-ghost btn-sm" title="Sign in again" onclick={() => openSignIn(l)}><RotateCcw />Sign in again</button>
						<button class="btn btn-ghost btn-icon btn-sm hover:text-danger" title="Remove" onclick={() => removeLogin(l)}><Trash2 /></button>
					</div>
				{/if}
			</div>
		{:else}
			<EmptyState title="No AWS sign-ins" body={admin ? 'Sign in to your AWS access portal, then add profiles: one account and role each, for sessions to use.' : 'An admin can connect AWS here.'}>
				{#snippet action()}{#if admin}<button class="btn btn-secondary btn-sm" onclick={() => openSignIn()}><BrandIcon brand="bedrock" class="size-4" />Sign in to AWS SSO</button>{/if}{/snippet}
			</EmptyState>
		{/each}
	</div>

	{#if profiles.length}
		<h3 class="mt-4 mb-2 text-xs font-semibold tracking-wider text-muted-foreground/80 uppercase">Profiles</h3>
		<div class="card divide-y divide-border">
			{#each profiles as p (p.id)}
				{@const l = loginById.get(p.loginId)}
				<div class="flex flex-wrap items-center gap-3 px-4 py-3">
					<ShieldCheck class="size-4 shrink-0 text-muted-foreground" />
					<div class="min-w-0 flex-1 basis-52">
						<p class="font-mono text-[0.8125rem] font-medium">{p.name}</p>
						<p class="mt-0.5 text-xs text-muted-foreground">
							{p.roleName} in {p.accountName ?? p.accountId} <span class="font-mono text-[0.6875rem]">({p.accountId})</span> · {p.region}{#if l} · via {loginName(l)}{/if}
						</p>
					</div>
					{#if admin}
						<div class="ml-auto flex items-center gap-1">
							<button class="btn btn-ghost btn-sm" title="Get credentials as a session would" disabled={testing === p.id} onclick={() => test(p)}>
								{#if testing === p.id}<LoaderCircle class="animate-spin" />{:else}<FlaskConical />{/if}Test
							</button>
							<button class="btn btn-ghost btn-icon btn-sm" title="Edit" onclick={() => openProfile(p)}><Pencil /></button>
							<button class="btn btn-ghost btn-icon btn-sm hover:text-danger" title="Remove" onclick={() => removeProfile(p)}><Trash2 /></button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
		<p class="mt-2 text-xs text-muted-foreground">
			Give sessions profiles under New session, a session's panel, or a repo profile above. Prefer read-only roles for agents; a session can do whatever its role allows.
		</p>
	{/if}
	{#if !admin && logins.length}<p class="mt-2 text-xs text-muted-foreground">Only an admin can change AWS access.</p>{/if}
</section>

<Dialog bind:open={signingIn} title="Sign in to AWS SSO" description="Orbital signs in with a code you confirm in your browser, like the AWS CLI's sso login." width="max-w-lg">
	<form id="aws-signin" class="space-y-3" onsubmit={startSignIn}>
		<div>
			<label class="label" for="aws-url">AWS access portal URL</label>
			<input id="aws-url" class="input font-mono text-[0.8125rem]" placeholder="https://acme.awsapps.com/start" bind:value={form.startUrl} required />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="label" for="aws-region">Identity Center region</label>
				<input id="aws-region" class="input font-mono text-[0.8125rem]" placeholder="us-east-1" bind:value={form.ssoRegion} required />
			</div>
			<div>
				<label class="label" for="aws-label">Name <span class="font-normal text-muted-foreground/70">(optional)</span></label>
				<input id="aws-label" class="input" placeholder="Acme" bind:value={form.label} />
			</div>
		</div>
		<p class="text-xs text-muted-foreground">Both are on the AWS access portal's settings, or in <code class="font-mono">~/.aws/config</code> as <code class="font-mono">sso_start_url</code> and <code class="font-mono">sso_region</code>.</p>
		{#if formError}<p class="text-xs text-danger">{formError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (signingIn = false)}>Cancel</button>
		<button class="btn btn-primary" form="aws-signin" disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{/if}Continue</button>
	{/snippet}
</Dialog>

<Dialog bind:open={() => !!device, (v) => !v && ((device = null), clearTimeout(timer))} title="Sign in to AWS SSO" width="max-w-md">
	{#if device}
		<div class="space-y-4 text-center">
			<p class="text-[0.8125rem] text-muted-foreground">Open the AWS page, check it shows this code, and allow access.</p>
			<button class="mx-auto block rounded-xl border border-border bg-surface px-5 py-3 font-mono text-2xl font-semibold tracking-[0.2em]" title="Copy" onclick={() => copyText(device!.userCode)}>{device.userCode}</button>
			<a class="btn btn-primary" href={device.verificationUri} target="_blank" rel="noopener"><ExternalLink />Open the AWS sign-in page</a>
			<p class="flex items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle class="size-3.5 animate-spin" />Waiting for approval…</p>
		</div>
	{/if}
</Dialog>

<Dialog bind:open={profileOpen} title={editing ? `Edit ${editing.name}` : 'Add an AWS profile'} description="One account and role. Sessions given this profile get its credentials, and nothing else." width="max-w-lg">
	<form id="aws-profile" class="space-y-3" onsubmit={saveProfile}>
		{#if logins.length > 1}
			<div>
				<label class="label" for="ap-login">Sign-in</label>
				<select
					id="ap-login"
					class="input"
					bind:value={pf.loginId}
					onchange={() => {
						pf.accountId = '';
						pf.roleName = '';
						void loadAccounts();
					}}
				>
					{#each logins as l (l.id)}<option value={l.id}>{loginName(l)}</option>{/each}
				</select>
			</div>
		{/if}
		<div>
			<label class="label flex items-center gap-1.5" for="ap-account">Account {#if loading === 'accounts'}<LoaderCircle class="size-3 animate-spin" />{/if}</label>
			<select
				id="ap-account"
				class="input"
				bind:value={pf.accountId}
				required
				onchange={() => {
					pf.roleName = '';
					void loadRoles();
				}}
			>
				<option value="" disabled>{accounts.length ? 'Pick an account' : 'Loading…'}</option>
				{#each accounts as a (a.accountId)}<option value={a.accountId}>{a.accountName ?? a.accountId} · {a.accountId}</option>{/each}
			</select>
		</div>
		<div>
			<label class="label flex items-center gap-1.5" for="ap-role">Role {#if loading === 'roles'}<LoaderCircle class="size-3 animate-spin" />{/if}</label>
			<select id="ap-role" class="input" bind:value={pf.roleName} required disabled={!pf.accountId} onchange={suggestName}>
				<option value="" disabled>{pf.accountId ? 'Pick a role' : 'Pick an account first'}</option>
				{#each roles as r (r)}<option value={r}>{r}</option>{/each}
			</select>
			<p class="mt-1 text-xs text-muted-foreground">The permission set the agent works with. A read-only one keeps a mistaken command from changing anything.</p>
		</div>
		<div class="grid grid-cols-[1fr_9rem] gap-3">
			<div>
				<label class="label" for="ap-name">Profile name</label>
				<input id="ap-name" class="input font-mono text-[0.8125rem]" placeholder="prod-readonly" bind:value={pf.name} oninput={() => (nameTouched = true)} required />
			</div>
			<div>
				<label class="label" for="ap-region">Region</label>
				<input id="ap-region" class="input font-mono text-[0.8125rem]" placeholder="eu-west-1" bind:value={pf.region} required />
			</div>
		</div>
		<p class="text-xs text-muted-foreground">In sessions it's <code class="font-mono">--profile {pf.name || '<name>'}</code> (and Terraform's <code class="font-mono">profile</code>); the first profile a session has is also its default.</p>
		{#if profileError}<p class="text-xs text-danger">{profileError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (profileOpen = false)}>Cancel</button>
		<button class="btn btn-primary" form="aws-profile" disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{/if}{editing ? 'Save' : 'Add profile'}</button>
	{/snippet}
</Dialog>

