<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { CircleAlert, CircleCheck, Copy, KeyRound, LoaderCircle, Network, Save, ShieldCheck, Trash2, Users } from '@lucide/svelte';
	import SettingsTabs from '#lib/components/SettingsTabs.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { copyText } from '#lib/client/clipboard.ts';
	import { ago } from '#lib/client/format.ts';
	import { confirmAction, toast } from '#lib/client/state.svelte.ts';
	import type { AuthSettings, User, UserRole } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Lists are edited as text, one entry per line.
	type Form = Omit<AuthSettings, 'proxy' | 'access'> & {
		proxy: Omit<AuthSettings['proxy'], 'trustedProxies'> & { trustedProxies: string };
		access: Record<keyof AuthSettings['access'], string>;
	};
	const toForm = (s: AuthSettings): Form => ({
		...s,
		oidc: { ...s.oidc },
		proxy: { ...s.proxy, trustedProxies: s.proxy.trustedProxies.join('\n') },
		access: {
			allowedEmails: s.access.allowedEmails.join('\n'),
			allowedGroups: s.access.allowedGroups.join('\n'),
			adminEmails: s.access.adminEmails.join('\n'),
			adminGroups: s.access.adminGroups.join('\n')
		}
	});

	let form = $state<Form>(untrack(() => toForm(data.auth)));
	let clientSecret = $state('');
	let removeSecret = $state(false);
	let saving = $state(false);
	let testing = $state(false);
	let tested = $state<string | null>(null);

	const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);
	const openAccess = $derived(!lines(form.access.allowedEmails).length && !lines(form.access.allowedGroups).length);
	const ssoOn = $derived(form.oidc.enabled || form.proxy.enabled);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!form.required) {
			const ok = await confirmAction({
				title: 'Turn sign-in off?',
				body: 'Anyone who can reach Orbital uses it as the admin, and can run code on this Docker host. Only do this behind a reverse proxy that already signs people in.',
				confirmLabel: 'Turn it off',
				danger: true
			});
			if (!ok) return;
		}
		saving = true;
		try {
			const payload = {
				...form,
				proxy: { ...form.proxy, trustedProxies: lines(form.proxy.trustedProxies) },
				access: Object.fromEntries(Object.entries(form.access).map(([k, v]) => [k, lines(v)])),
				clientSecret: removeSecret ? null : clientSecret || undefined
			};
			const r = await api.put<{ settings: AuthSettings }>('/api/sign-in', payload);
			form = toForm(r.settings);
			clientSecret = '';
			removeSecret = false;
			toast('success', 'Sign-in settings saved');
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't save", errorMessage(err));
		}
		saving = false;
	}

	async function testIssuer() {
		testing = true;
		tested = null;
		try {
			const r = await api.post<{ issuer: string }>('/api/sign-in/test', { issuer: form.oidc.issuer });
			tested = r.issuer;
		} catch (err) {
			toast('error', 'Not an OpenID Connect issuer', errorMessage(err));
		}
		testing = false;
	}

	async function setRole(u: User, role: UserRole) {
		try {
			await api.patch(`/api/users/${u.id}`, { role });
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't change the role", errorMessage(err));
			await invalidateAll();
		}
	}

	async function removeUser(u: User) {
		const ok = await confirmAction({
			title: `Remove ${u.email}?`,
			body: u.source === 'local' ? 'They can no longer sign in with a password.' : 'They are signed out. If single sign-on still lets them in, they come back as a new member on their next sign-in.',
			confirmLabel: 'Remove',
			danger: true
		});
		if (!ok) return;
		try {
			await api.del(`/api/users/${u.id}`);
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't remove them", errorMessage(err));
		}
	}

	const SOURCE: Record<User['source'], string> = { local: 'Password', oidc: 'SSO', proxy: 'Reverse proxy' };

	const PROVIDERS = [
		{ name: 'Authentik', issuer: 'https://auth.example.com/application/o/orbital/' },
		{ name: 'Authelia', issuer: 'https://auth.example.com' },
		{ name: 'Keycloak', issuer: 'https://kc.example.com/realms/home' },
		{ name: 'Pocket ID', issuer: 'https://id.example.com' }
	];
</script>

<svelte:head><title>Sign-in · Orbital</title></svelte:head>

<div class="h-full overflow-y-auto">
	<SettingsTabs admin description="Who can sign in to Orbital, and how." />

	<form class="max-w-4xl space-y-6 px-4 pt-6 pb-12 sm:px-8" onsubmit={save}>
		{#if data.envDisabled}
			<div class="card flex items-start gap-3 border-warning/40 p-4 text-[0.8125rem]">
				<CircleAlert class="mt-0.5 size-4 shrink-0 text-warning" />
				<p><code class="font-mono text-xs">ORB_AUTH=disabled</code> is set on the container, so sign-in is off whatever you choose here. Remove it to use these settings.</p>
			</div>
		{/if}

		<section class="card divide-y divide-border">
			<div class="flex items-center justify-between gap-4 p-5">
				<span>
					<span class="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight"><ShieldCheck class="size-4 text-primary" />Require sign-in</span>
					<span class="mt-0.5 block text-xs text-muted-foreground">Off: anyone who can reach Orbital uses it as the admin. Only for a reverse proxy that already signs people in.</span>
				</span>
				<Switch bind:checked={form.required} label="Require sign-in" />
			</div>
			{#if !form.required}
				<p class="flex items-start gap-2 bg-warning/10 px-5 py-3 text-xs text-warning">
					<CircleAlert class="mt-px size-3.5 shrink-0" />Orbital starts containers with access to your GitHub and model accounts: whoever opens it can run code on this host.
				</p>
			{/if}
			<div class="flex items-center justify-between gap-4 p-5 {form.required ? '' : 'opacity-50'}">
				<span>
					<span class="flex items-center gap-2 text-[0.8125rem] font-medium"><KeyRound class="size-4 text-muted-foreground" />Password sign-in</span>
					<span class="mt-0.5 block text-xs text-muted-foreground">
						The email and password form on the sign-in page. With it hidden, the local admin can still sign in at
						<code class="font-mono">/login?local</code>, for when single sign-on is down.
					</span>
				</span>
				<Switch bind:checked={form.passwordForm} disabled={!form.required} label="Password sign-in" />
			</div>
		</section>

		<section class="card space-y-4 p-5 {form.required ? '' : 'opacity-60'}">
			<div class="flex items-center justify-between gap-4">
				<span>
					<span class="text-[0.9375rem] font-semibold tracking-tight">Single sign-on (OpenID Connect)</span>
					<span class="mt-0.5 block text-xs text-muted-foreground">A <b class="font-medium text-foreground">Sign in with…</b> button for Authentik, Authelia, Keycloak, Pocket ID, Zitadel, Google, Entra ID…</span>
				</span>
				<Switch bind:checked={form.oidc.enabled} label="Single sign-on" />
			</div>
			{#if form.oidc.enabled}
				<div class="rounded-lg border border-border bg-surface p-3 text-xs">
					<p class="text-muted-foreground">Register Orbital with your provider as a confidential web app with this redirect URI:</p>
					<button type="button" class="mt-1.5 flex max-w-full items-center gap-1.5 font-mono text-[0.75rem] text-foreground hover:text-primary" onclick={() => copyText(data.callbackUrl, 'Copied the redirect URI')}>
						<Copy class="size-3.5 shrink-0" /><span class="truncate">{data.callbackUrl}</span>
					</button>
					{#if !data.publicUrlSet}
						<p class="mt-1.5 text-muted-foreground">Built from the address you're using now. If people open Orbital elsewhere, set <a class="text-primary hover:underline" href="/settings">Settings → Public URL</a> first.</p>
					{/if}
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="sm:col-span-2">
						<label class="label" for="iss">Issuer URL</label>
						<div class="flex gap-2">
							<input id="iss" class="input font-mono text-xs" placeholder="https://auth.example.com/application/o/orbital/" bind:value={form.oidc.issuer} oninput={() => (tested = null)} />
							<button type="button" class="btn btn-secondary shrink-0" disabled={!form.oidc.issuer || testing} onclick={testIssuer}>
								{#if testing}<LoaderCircle class="animate-spin" />{:else if tested}<CircleCheck class="text-success" />{/if}Test
							</button>
						</div>
						<p class="mt-1.5 text-xs text-muted-foreground">
							{#if tested}Found <span class="font-mono">{tested}</span>.{:else}For example: {#each PROVIDERS as p, i (p.name)}{i ? ', ' : ''}<span class="font-medium text-foreground/80">{p.name}</span> <span class="font-mono">{p.issuer}</span>{/each}.{/if}
						</p>
					</div>
					<div>
						<label class="label" for="cid">Client ID</label>
						<input id="cid" class="input font-mono text-xs" autocomplete="off" bind:value={form.oidc.clientId} />
					</div>
					<div>
						<label class="label flex items-center justify-between" for="csec">
							<span>Client secret</span>
							{#if form.oidc.hasSecret}
								<button type="button" class="text-[0.6875rem] {removeSecret ? 'text-danger' : 'text-muted-foreground hover:text-danger'}" onclick={() => (removeSecret = !removeSecret)}>{removeSecret ? 'Will be removed' : 'Remove'}</button>
							{/if}
						</label>
						<input
							id="csec"
							class="input font-mono text-xs"
							type="password"
							autocomplete="off"
							placeholder={form.oidc.hasSecret ? '•••••••• stored; type to replace' : 'Empty for a public client (PKCE only)'}
							bind:value={clientSecret}
							disabled={removeSecret}
						/>
					</div>
					<div>
						<label class="label" for="lbl">Button label</label>
						<input id="lbl" class="input" placeholder="SSO" bind:value={form.oidc.label} />
						<p class="mt-1 text-xs text-muted-foreground">Shown as “Sign in with {form.oidc.label || 'SSO'}”.</p>
					</div>
					<div>
						<label class="label" for="scp">Scopes</label>
						<input id="scp" class="input font-mono text-xs" bind:value={form.oidc.scopes} />
					</div>
					<div>
						<label class="label" for="gcl">Groups claim</label>
						<input id="gcl" class="input font-mono text-xs" placeholder="groups" bind:value={form.oidc.groupsClaim} />
						<p class="mt-1 text-xs text-muted-foreground">For group rules below. Dotted paths work, e.g. <code class="font-mono">realm_access.roles</code>.</p>
					</div>
				</div>
			{/if}
		</section>

		<section class="card space-y-4 p-5 {form.required ? '' : 'opacity-60'}">
			<div class="flex items-center justify-between gap-4">
				<span>
					<span class="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight"><Network class="size-4 text-primary" />Reverse proxy sign-in</span>
					<span class="mt-0.5 block text-xs text-muted-foreground">Forward auth: your proxy (Authelia, Authentik, oauth2-proxy, Tailscale…) signs people in and passes who they are in headers.</span>
				</span>
				<Switch bind:checked={form.proxy.enabled} label="Reverse proxy sign-in" />
			</div>
			{#if form.proxy.enabled}
				<div class="grid gap-4 sm:grid-cols-3">
					<div>
						<label class="label" for="eh">Email header</label>
						<input id="eh" class="input font-mono text-xs" placeholder="Remote-Email" bind:value={form.proxy.emailHeader} />
					</div>
					<div>
						<label class="label" for="nh">Name header</label>
						<input id="nh" class="input font-mono text-xs" placeholder="Remote-Name" bind:value={form.proxy.nameHeader} />
					</div>
					<div>
						<label class="label" for="gh">Groups header</label>
						<input id="gh" class="input font-mono text-xs" placeholder="Remote-Groups" bind:value={form.proxy.groupsHeader} />
					</div>
					<div class="sm:col-span-2">
						<label class="label" for="tp">Trusted proxies</label>
						<textarea id="tp" class="input min-h-24 py-2 font-mono text-xs" bind:value={form.proxy.trustedProxies}></textarea>
						<p class="mt-1 text-xs text-muted-foreground">
							Addresses or CIDR ranges, one per line. The headers are ignored from anywhere else.
							{#if data.clientAddress}This page came through <button type="button" class="font-mono text-foreground hover:text-primary" onclick={() => copyText(data.clientAddress!)}>{data.clientAddress}</button>.{/if}
						</p>
					</div>
					<div>
						<label class="label" for="lo">Logout URL <span class="font-normal text-muted-foreground">· optional</span></label>
						<input id="lo" class="input font-mono text-xs" placeholder="https://auth.example.com/logout" bind:value={form.proxy.logoutUrl} />
						<p class="mt-1 text-xs text-muted-foreground">Sign out goes here, so the proxy doesn't sign you straight back in.</p>
					</div>
				</div>
				<p class="flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-xs text-muted-foreground">
					<CircleAlert class="mt-px size-3.5 shrink-0" />Make sure the proxy strips these headers from incoming requests, and that Orbital's port is only reachable through the proxy.
				</p>
			{/if}
		</section>

		{#if ssoOn}
			<section class="card space-y-4 p-5">
				<div>
					<span class="text-[0.9375rem] font-semibold tracking-tight">Who can sign in with SSO</span>
					<span class="mt-0.5 block text-xs text-muted-foreground">Emails (<code class="font-mono">sam@example.com</code>), domains (<code class="font-mono">@example.com</code>) or <code class="font-mono">*</code>; groups by name. One per line.</span>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="label" for="ae">Allowed emails</label>
						<textarea id="ae" class="input min-h-20 py-2 font-mono text-xs" bind:value={form.access.allowedEmails}></textarea>
					</div>
					<div>
						<label class="label" for="ag">Allowed groups</label>
						<textarea id="ag" class="input min-h-20 py-2 font-mono text-xs" bind:value={form.access.allowedGroups}></textarea>
					</div>
					<div>
						<label class="label" for="de">Admin emails</label>
						<textarea id="de" class="input min-h-20 py-2 font-mono text-xs" bind:value={form.access.adminEmails}></textarea>
					</div>
					<div>
						<label class="label" for="dg">Admin groups</label>
						<textarea id="dg" class="input min-h-20 py-2 font-mono text-xs" bind:value={form.access.adminGroups}></textarea>
					</div>
				</div>
				<p class="text-xs {openAccess ? 'text-warning' : 'text-muted-foreground'}">
					{#if openAccess}With no allowed emails or groups, everyone your provider lets through can sign in.{:else}Admins can always sign in.{/if}
					Members use sessions, accounts and automations; admins also manage sign-in and users.
				</p>
			</section>
		{/if}

		<div class="flex justify-end">
			<button class="btn btn-primary" disabled={saving}>{#if saving}<LoaderCircle class="animate-spin" />{:else}<Save />{/if}Save sign-in settings</button>
		</div>

		<section>
			<h2 class="mb-3 flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight"><Users class="size-4 text-primary" />Users</h2>
			<div class="card divide-y divide-border">
				{#each data.users as u (u.id)}
					<div class="flex flex-wrap items-center gap-3 px-4 py-3">
						<span class="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary uppercase">{(u.name ?? u.email).slice(0, 1)}</span>
						<div class="min-w-0 flex-1 basis-52">
							<p class="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium">
								{u.name ?? u.email}{#if u.id === data.me}<span class="badge">You</span>{/if}<span class="badge">{SOURCE[u.source]}</span>
							</p>
							<p class="truncate text-xs text-muted-foreground">{[u.name ? u.email : null, u.lastLoginAt ? `signed in ${ago(u.lastLoginAt)}` : 'never signed in'].filter(Boolean).join(' · ')}</p>
						</div>
						<div class="ml-auto flex items-center gap-1">
							<select class="input h-8 w-auto text-xs" value={u.role} onchange={(e) => setRole(u, e.currentTarget.value as UserRole)} aria-label="Role">
								<option value="admin">Admin</option>
								<option value="member">Member</option>
							</select>
							<button type="button" class="btn btn-ghost btn-icon btn-sm hover:text-danger" title="Remove" disabled={u.id === data.me} onclick={() => removeUser(u)}><Trash2 /></button>
						</div>
					</div>
				{/each}
			</div>
			<p class="mt-2 text-xs text-muted-foreground">SSO users appear here the first time they sign in. The local admin made at setup signs in with a password.</p>
		</section>
	</form>
</div>
