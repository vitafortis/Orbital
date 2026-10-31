<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy, onMount, tick } from 'svelte';
	import {
		Building2,
		CircleCheck,
		CircleHelp,
		ChevronDown,
		Cloud,
		ChevronLeft,
		ChevronRight,
		ChevronUp,
		CircleX,
		ExternalLink,
		Layers,
		Network,
		Pencil,
		LoaderCircle,
		LogIn,
		Plus,
		Send,
		RefreshCw,
		Trash2,
		KeyRound
	} from '@lucide/svelte';
	import AwsAccounts from '#lib/components/AwsAccounts.svelte';
	import AwsProfilePicker from '#lib/components/AwsProfilePicker.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import GettingStarted from '#lib/components/GettingStarted.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import ModelPicker from '#lib/components/ModelPicker.svelte';
	import { modelLabel } from '#lib/models.ts';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import LinkBar from '#lib/components/LinkBar.svelte';
	import Terminal from '#lib/components/Terminal.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { copyText } from '#lib/client/clipboard.ts';
	import { ago, githubLabel } from '#lib/client/format.ts';
	import { confirmAction, toast, useSessions } from '#lib/client/state.svelte.ts';
	import AgentBadge from '#lib/components/AgentBadge.svelte';
	import BrandIcon from '#lib/components/BrandIcon.svelte';
	import { matchProfile } from '#lib/profiles.ts';
	import { GROUP_BRAND, KIND_BRAND } from '#lib/brands.ts';
	import { ACCOUNT_KINDS, AGENT_LABEL, AGENT_PERMISSION_MODES, fitPermissionMode, type KindSpec } from '#lib/providers.ts';
	import { PERMISSION_MODES, type AccountKind, type Agent, type GithubAccount, type ModelAccount, type PermissionMode, type Profile } from '#lib/types.ts';
	import type { PageProps } from './$types';

	const shown = useSessions();

	let { data }: PageProps = $props();

	// ── Model accounts ──────────────────────────────────────────────────

	const GROUPS = [...new Set(Object.values(ACCOUNT_KINDS).map((k) => k.group))];
	const kindsIn = (g: string) => (Object.entries(ACCOUNT_KINDS) as [AccountKind, KindSpec][]).filter(([, k]) => k.group === g);

	// The account dialog adds one (any kind) or edits one (its kind is fixed).
	let editing = $state<ModelAccount | null>(null);
	let adding = $state(false);
	// Adding is two steps: pick a provider from a short list, then its fields.
	let step = $state<'pick' | 'form'>('pick');
	let kind = $state<AccountKind>('subscription');
	let name = $state('');
	let fields = $state<Record<string, string>>({});
	let saving = $state(false);
	let formError = $state('');
	const spec = $derived(ACCOUNT_KINDS[kind]);

	let login = $state<ModelAccount | null>(null);
	let loginReady = $state(false);
	let loginLink = $state<string | null>(null);
	let loginLinks = $state<string[]>([]);
	let loginCode = $state<string | null>(null);
	let loginTerm = $state<Terminal>();
	let pasted = $state('');
	let finishing = $state(false);
	let checking = $state<string | null>(null);

	function defaultsFor(k: AccountKind, config: Record<string, string> = {}) {
		return Object.fromEntries(ACCOUNT_KINDS[k].fields.map((f) => [f.key, f.secret ? '' : (config[f.key] ?? f.default ?? '')]));
	}

	function openAdd() {
		editing = null;
		kind = 'subscription';
		name = data.accounts.length ? '' : 'Personal';
		fields = defaultsFor(kind);
		formError = '';
		step = 'pick';
		adding = true;
	}

	function openEdit(a: ModelAccount) {
		editing = a;
		step = 'form';
		kind = a.kind;
		name = a.name;
		fields = defaultsFor(a.kind, a.config);
		formError = '';
		adding = true;
	}

	function pickKind(k: AccountKind) {
		kind = k;
		fields = defaultsFor(k);
		formError = '';
		step = 'form';
		// The form shares the list's scroll area: start it at the top.
		void tick().then(() => document.querySelector('dialog[open] .overflow-y-auto')?.scrollTo(0, 0));
	}

	async function saveAccount(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		formError = '';
		try {
			if (editing) {
				await api.patch<ModelAccount>(`/api/model-accounts/${editing.id}`, { name: name || editing.name, fields });
				adding = false;
				const a = editing;
				await invalidateAll();
				if (!ACCOUNT_KINDS[a.kind].signIn) void check(a);
			} else {
				const a = await api.post<ModelAccount>('/api/model-accounts', { kind, name: name || spec.label, fields });
				adding = false;
				await invalidateAll();
				if (ACCOUNT_KINDS[a.kind].signIn) void startLogin(a);
				else void check(a);
			}
		} catch (err) {
			formError = errorMessage(err);
		}
		saving = false;
	}

	const SIGN_IN: Record<Agent, { title: string; help: string }> = {
		claude: { title: 'Sign in to Claude', help: 'Open the link Claude prints, approve, then paste the code back into the terminal.' },
		codex: { title: 'Sign in to ChatGPT', help: 'Open the link Codex prints and enter the one-time code shown in the terminal.' },
		gemini: { title: 'Sign in to Google', help: 'Open the link Gemini prints, approve, then paste the code back into the terminal.' }
	};

	/** Opens the sign-in terminal: the one already running for the account, or a new one. */
	async function startLogin(a: ModelAccount, restart = false) {
		login = a;
		markSignIn(a.id);
		loginReady = false;
		loginLink = null;
		loginLinks = [];
		loginCode = null;
		pasted = '';
		try {
			await api.post(`/api/model-accounts/${a.id}/login`, { restart });
			loginReady = true;
		} catch (err) {
			login = null;
			toast('error', "Couldn't start the sign-in", errorMessage(err));
		}
	}

	async function finishLogin() {
		const a = login;
		if (!a) return;
		finishing = true;
		try {
			const r = await api.del<ModelAccount>(`/api/model-accounts/${a.id}/login`);
			if (r.status === 'signed_in') toast('success', `Signed in${r.email ? ` as ${r.email}` : ''}`);
			else toast('info', 'Not signed in yet', 'Run the sign-in again whenever you like.');
		} catch (err) {
			toast('error', "Couldn't check the sign-in", errorMessage(err));
		}
		finishing = false;
		login = null;
		markSignIn(null);
		await invalidateAll();
	}

	// Links wrap in the terminal and are hard to select on a phone: offer them as buttons,
	// with any one-time code, for as long as the sign-in is open.
	$effect(() => {
		if (!login || !loginReady) return;
		const id = login.id;
		const t = setInterval(async () => {
			const r = await api.get<{ url: string | null; links: string[]; code: string | null }>(`/api/model-accounts/${id}/login`).catch(() => null);
			if (!r) return;
			if (r.url) loginLink = r.url;
			loginLinks = r.links;
			loginCode = r.code;
		}, 1500);
		return () => clearInterval(t);
	});

	/**
	 * Types the code from the provider into the terminal and presses Enter. It goes through
	 * the server, not the terminal's connection, which a phone drops while the provider's page
	 * is open in another tab.
	 */
	let sending = $state(false);
	async function sendPasted(e: SubmitEvent) {
		e.preventDefault();
		const text = pasted.trim();
		if (!text || !login) return;
		sending = true;
		try {
			await api.post(`/api/model-accounts/${login.id}/login/input`, { text });
			pasted = '';
			toast('success', 'Sent the code', 'Press Done once the terminal says you’re signed in.');
		} catch (err) {
			toast('error', "Couldn't send the code", errorMessage(err));
		}
		sending = false;
	}

	/** Hides the sign-in without ending it: the container keeps waiting for the code (for 30 minutes). */
	function hideLogin() {
		login = null;
		markSignIn(null);
		void invalidateAll();
	}

	async function restartLogin() {
		const a = login;
		if (!a) return;
		const ok = await confirmAction({ title: 'Start the sign-in over?', body: 'You get a new link; a code from the old one will no longer work.', confirmLabel: 'Start over' });
		if (ok) void startLogin(a, true);
	}

	const signingIn = $derived(new Set(data.signingIn));

	// The open sign-in is kept in the address (?signin=<id>): a phone that reloads the page
	// after a trip to the provider's page lands back in the same sign-in.
	function markSignIn(id: string | null) {
		const url = new URL(location.href);
		if (id) url.searchParams.set('signin', id);
		else url.searchParams.delete('signin');
		history.replaceState(history.state, '', url);
	}
	onMount(() => {
		const id = page.url.searchParams.get('signin');
		const a = id && data.signingIn.includes(id) ? data.accounts.find((x) => x.id === id) : null;
		if (a) void startLogin(a);
		else if (id) markSignIn(null);
		// Links from the getting-started guide (?add=model, ?add=github) open their dialog.
		const add = page.url.searchParams.get('add');
		if (add) {
			const url = new URL(location.href);
			url.searchParams.delete('add');
			history.replaceState(history.state, '', url);
			if (add === 'model') openAdd();
			else if (add === 'github') openToken(null);
		}
		const check = data.githubAccounts.find((a) => a.id === page.url.searchParams.get('check'));
		if (check) openCheck(check, page.url.searchParams.get('repo') ?? '');
	});

	async function check(a: ModelAccount) {
		checking = a.id;
		try {
			const r = await api.post<ModelAccount>(`/api/model-accounts/${a.id}/check`);
			if (r.status === 'signed_in') toast('success', `${a.name} works`, r.email ?? undefined);
			else if (r.status === 'signed_out') toast('error', ACCOUNT_KINDS[a.kind].signIn ? `${a.name} isn't signed in` : `${a.name} doesn't work`);
			else toast('info', `Couldn't tell whether ${a.name} works`);
		} catch (err) {
			toast('error', `${a.name} doesn't work`, errorMessage(err));
		}
		checking = null;
		await invalidateAll();
	}

	async function removeAccount(a: ModelAccount) {
		const used = data.profiles.filter((p) => p.accountId === a.id);
		const ok = await confirmAction({
			title: `Remove ${a.name}?`,
			body:
				`This deletes its sign-in, keys, settings and stored conversations from this server. The account at ${ACCOUNT_KINDS[a.kind].group} itself is not affected.` +
				(used.length ? ` ${used.length === 1 ? 'The profile' : 'The profiles'} ${used.map((p) => `“${p.name}”`).join(', ')} will be removed too.` : ''),
			confirmLabel: 'Remove',
			danger: true
		});
		if (!ok) return;
		try {
			await api.del(`/api/model-accounts/${a.id}`);
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't remove it", errorMessage(err));
		}
	}

	function details(a: ModelAccount): string {
		const label = ACCOUNT_KINDS[a.kind].label;
		const plan = a.plan && a.plan !== label && !/^[a-z_]+$/.test(a.plan) ? a.plan : null;
		return [label, a.config.region, a.config.baseUrl, a.email, plan, a.checkedAt && `checked ${ago(a.checkedAt)}`].filter(Boolean).join(' · ');
	}

	// ── Profiles ────────────────────────────────────────────────────────

	const accountById = $derived(new Map(data.accounts.map((a) => [a.id, a])));

	let profileOpen = $state(false);
	let profileEditing = $state<Profile | null>(null);
	let pf = $state({ name: '', accountId: '', model: '', permissionMode: 'default' as PermissionMode, repos: '', awsProfileIds: [] as string[] });
	let profileError = $state('');
	let tryRepo = $state('');
	const pfAgent = $derived(accountById.get(pf.accountId)?.agent ?? 'claude');
	const pfModes = $derived(PERMISSION_MODES.filter((m) => AGENT_PERMISSION_MODES[pfAgent].includes(m.value)));
	const tried = $derived(tryRepo.trim() ? matchProfile(data.profiles, tryRepo.trim()) : undefined);

	function openProfile(p?: Profile) {
		profileEditing = p ?? null;
		pf = p
			? { name: p.name, accountId: p.accountId, model: p.model ?? '', permissionMode: p.permissionMode, repos: p.repos.join('\n'), awsProfileIds: p.awsProfileIds.filter((id) => data.awsProfiles.some((a) => a.id === id)) }
			: { name: '', accountId: data.accounts[0]?.id ?? '', model: '', permissionMode: 'default', repos: '', awsProfileIds: [] };
		profileError = '';
		profileOpen = true;
	}

	async function saveProfile(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		profileError = '';
		const payload = { ...pf, model: pf.model || null, permissionMode: fitPermissionMode(pfAgent, pf.permissionMode) };
		try {
			if (profileEditing) await api.put(`/api/profiles/${profileEditing.id}`, payload);
			else await api.post('/api/profiles', payload);
			profileOpen = false;
			await invalidateAll();
		} catch (err) {
			profileError = errorMessage(err);
		}
		saving = false;
	}

	async function moveProfile(i: number, by: number) {
		const ids = data.profiles.map((p) => p.id);
		const j = i + by;
		if (j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		try {
			await api.put('/api/profiles/order', { ids });
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't reorder", errorMessage(err));
		}
	}

	async function removeProfile(p: Profile) {
		const ok = await confirmAction({ title: `Delete the profile ${p.name}?`, body: 'Matching repos go back to the account you pick each time. Linear rules that used it fall back to their own settings.', confirmLabel: 'Delete', danger: true });
		if (!ok) return;
		await api.del(`/api/profiles/${p.id}`).catch((err) => toast('error', "Couldn't delete it", errorMessage(err)));
		await invalidateAll();
	}

	// ── GitHub ──────────────────────────────────────────────────────────

	// "Check access": GitHub's raw answers for a token, to see why a repo is missing.
	type TokenCheck = { kind: string; token: string; checks: { label: string; path: string; status: number; answer: string; headers: Record<string, string> }[] };
	let checking_ = $state<GithubAccount | null>(null);
	let checkRepo = $state('');
	let checkResult = $state<TokenCheck | null>(null);
	let checkBusy = $state(false);
	let checkError = $state('');
	async function runCheck(e?: SubmitEvent) {
		e?.preventDefault();
		if (!checking_) return;
		checkBusy = true;
		checkError = '';
		try {
			checkResult = await api.get<TokenCheck>(`/api/github-accounts/${checking_.id}/check${checkRepo.trim() ? `?repo=${encodeURIComponent(checkRepo.trim())}` : ''}`);
		} catch (err) {
			checkError = errorMessage(err);
		}
		checkBusy = false;
	}
	function openCheck(a: GithubAccount, repo = '') {
		checking_ = a;
		checkRepo = repo;
		checkResult = null;
		checkError = '';
		void runCheck();
	}

	let addingToken = $state(false);
	/** The connection being edited (rename or new token); null when adding one. */
	let editingGithub = $state<GithubAccount | null>(null);
	let token = $state('');
	let tokenLabel = $state('');
	let tokenError = $state('');

	function openToken(a: GithubAccount | null) {
		editingGithub = a;
		tokenLabel = a?.label ?? '';
		token = '';
		tokenError = '';
		addingToken = true;
	}
	let device = $state<{ handle: string; userCode: string; verificationUri: string; interval: number } | null>(null);
	let deviceTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(deviceTimer));

	async function addToken(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		tokenError = '';
		try {
			const label = tokenLabel.trim() || null;
			const a = editingGithub
				? await api.patch<GithubAccount>(`/api/github-accounts/${editingGithub.id}`, { label, ...(token.trim() ? { token } : {}) })
				: await api.post<GithubAccount>('/api/github-accounts', { token, label });
			addingToken = false;
			token = '';
			if (editingGithub) toast('success', `Saved ${githubLabel(a)}`);
			else toast('success', `Connected ${githubLabel(a)}`, a.orgs.length ? `Organizations: ${a.orgs.join(', ')}` : undefined);
			await invalidateAll();
		} catch (err) {
			tokenError = errorMessage(err);
		}
		saving = false;
	}

	async function startDevice() {
		try {
			device = await api.post('/api/github/device');
			poll();
		} catch (err) {
			toast('error', "Couldn't start GitHub sign-in", errorMessage(err));
		}
	}

	function poll() {
		if (!device) return;
		deviceTimer = setTimeout(async () => {
			if (!device) return;
			try {
				const r = await api.post<{ state: string; account?: GithubAccount; interval?: number }>('/api/github/device/poll', { handle: device.handle });
				if (r.state === 'pending') {
					device.interval = r.interval ?? device.interval;
					poll();
					return;
				}
				if (r.state === 'done' && r.account) {
					toast('success', `Connected ${r.account.login}`);
					await invalidateAll();
				} else toast('error', r.state === 'denied' ? 'GitHub sign-in was declined' : 'The code expired. Try again.');
			} catch (err) {
				toast('error', 'GitHub sign-in failed', errorMessage(err));
			}
			device = null;
		}, device.interval * 1000);
	}

	async function refreshGithub(a: GithubAccount) {
		try {
			await api.post(`/api/github-accounts/${a.id}`);
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't refresh", errorMessage(err));
		}
	}

	async function removeGithub(a: GithubAccount) {
		const ok = await confirmAction({
			title: `Disconnect ${githubLabel(a)}?`,
			body: 'Orbital forgets the token. Running sessions keep working until they restart. Revoke the token on GitHub too if you no longer need it.',
			confirmLabel: 'Disconnect',
			danger: true
		});
		if (!ok) return;
		await api.del(`/api/github-accounts/${a.id}`);
		await invalidateAll();
	}
</script>

<svelte:head><title>Accounts · Orbital</title></svelte:head>

{#snippet statusBadge(a: ModelAccount)}
	{@const signIn = ACCOUNT_KINDS[a.kind].signIn}
	{#if a.status === 'signed_in'}
		<span class="badge badge-success"><CircleCheck />{signIn ? 'Signed in' : 'Ready'}</span>
	{:else if a.status === 'signed_out'}
		<span class="badge badge-warning"><CircleX />{signIn ? 'Not signed in' : 'Not working'}</span>
	{:else}
		<span class="badge"><CircleHelp />Not checked</span>
	{/if}
{/snippet}

<div class="h-full overflow-y-auto">
	<PageHeader title="Accounts" description="The models sessions run on, which repos use which, and how sessions reach GitHub." />

	<div class="max-w-4xl space-y-8 px-4 pb-12 sm:px-8">
		{#if !shown.list.length}
			<GettingStarted compact accounts={data.accounts} signingIn={data.signingIn} githubAccounts={data.githubAccounts.length} onaddmodel={openAdd} onaddgithub={() => openToken(null)} />
		{/if}

		<section>
			<div class="mb-3 flex items-end justify-between gap-3">
				<div>
					<h2 class="text-[0.9375rem] font-semibold tracking-tight">Models</h2>
					<p class="text-xs text-muted-foreground">Claude through Anthropic or your cloud, OpenAI through Codex CLI, Gemini through Gemini CLI. Sessions of one account share its sign-in and settings.</p>
				</div>
				<button class="btn {data.accounts.length ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick={openAdd}><Plus />Add account</button>
			</div>
			<div class="card divide-y divide-border">
				{#each data.accounts as a (a.id)}
					<div class="flex flex-wrap items-center gap-3 px-4 py-3">
						<span class="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-surface text-foreground max-sm:hidden">
							{#if KIND_BRAND[a.kind]}<BrandIcon brand={KIND_BRAND[a.kind]!} class="size-[1.125rem]" />{:else}<Network class="size-4 text-muted-foreground" />{/if}
						</span>
						<div class="min-w-0 flex-1 basis-52">
							<p class="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium">{a.name} <AgentBadge agent={a.agent} /> {@render statusBadge(a)}</p>
							<p class="truncate text-xs text-muted-foreground">{details(a)}</p>
						</div>
						<div class="ml-auto flex items-center gap-1.5">
							{#if ACCOUNT_KINDS[a.kind].signIn}
								<button class="btn btn-sm {a.status === 'signed_in' ? 'btn-ghost' : 'btn-primary'}" onclick={() => startLogin(a)}
									><LogIn />{signingIn.has(a.id) ? 'Continue sign-in' : a.status === 'signed_in' ? 'Sign in again' : 'Sign in'}</button
								>
							{/if}
							<button class="btn btn-ghost btn-sm" disabled={checking === a.id} onclick={() => check(a)}>
								{#if checking === a.id}<LoaderCircle class="animate-spin" />{:else}<RefreshCw />{/if}Check
							</button>
							<button class="btn btn-ghost btn-icon btn-sm" title="Edit" onclick={() => openEdit(a)}><Pencil /></button>
							<button class="btn btn-ghost btn-icon btn-sm hover:text-danger" title="Remove" onclick={() => removeAccount(a)}><Trash2 /></button>
						</div>
					</div>
				{:else}
					<EmptyState icon={KeyRound} title="No model accounts yet" body="Sessions run as one of these: your Claude plan or API key, Claude on your cloud, OpenAI or Gemini.">
						{#snippet action()}<button class="btn btn-primary btn-sm" onclick={openAdd}><Plus />Add a model account</button>{/snippet}
					</EmptyState>
				{/each}
			</div>
		</section>

		<!-- Profiles route repos to accounts: nothing to say until there's an account. -->
		{#if data.accounts.length}
			<section id="profiles">
				<div class="mb-3 flex items-end justify-between gap-3">
					<div>
						<h2 class="text-[0.9375rem] font-semibold tracking-tight">Profiles</h2>
						<p class="text-xs text-muted-foreground">Which repos go to which model. New sessions and Linear rules pick the first profile matching the repo.</p>
					</div>
					<button class="btn btn-secondary btn-sm" disabled={!data.accounts.length} onclick={() => openProfile()}><Plus />Add profile</button>
				</div>
				<div class="card divide-y divide-border">
					{#each data.profiles as p, i (p.id)}
						{@const acct = accountById.get(p.accountId)}
						<div class="flex flex-wrap items-center gap-3 px-4 py-3">
							<div class="flex flex-col">
								<button class="btn btn-ghost btn-icon h-4 w-6 disabled:opacity-20" title="Match earlier" disabled={i === 0} onclick={() => moveProfile(i, -1)}><ChevronUp /></button>
								<button class="btn btn-ghost btn-icon h-4 w-6 disabled:opacity-20" title="Match later" disabled={i === data.profiles.length - 1} onclick={() => moveProfile(i, 1)}><ChevronDown /></button>
							</div>
							<div class="min-w-0 flex-1 basis-52">
								<p class="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium">
									{p.name}
									{#if acct}<AgentBadge agent={acct.agent} />{/if}
								</p>
								<p class="truncate text-xs text-muted-foreground">
									{acct?.name ?? 'Missing account'} · {p.model ? modelLabel(p.model) : 'default model'} · {PERMISSION_MODES.find((m) => m.value === p.permissionMode)?.label}
									{#each data.awsProfiles.filter((a) => p.awsProfileIds.includes(a.id)) as a (a.id)} · <span class="font-mono">{a.name}</span>{/each}
								</p>
								<p class="mt-1 flex flex-wrap gap-1">
									{#each p.repos as r (r)}<span class="badge font-mono">{r}</span>{:else}<span class="text-xs text-muted-foreground">No repos: only used when picked</span>{/each}
								</p>
							</div>
							<div class="ml-auto flex items-center gap-1">
								<button class="btn btn-ghost btn-icon btn-sm" title="Edit" onclick={() => openProfile(p)}><Pencil /></button>
								<button class="btn btn-ghost btn-icon btn-sm hover:text-danger" title="Delete" onclick={() => removeProfile(p)}><Trash2 /></button>
							</div>
						</div>
					{:else}
						<EmptyState icon={Layers} title="No profiles" body="Every session uses the account you pick for it. A profile picks one by repo: work repos on Bedrock, side projects on Codex.">
							{#snippet action()}<button class="btn btn-secondary btn-sm" onclick={() => openProfile()}><Plus />Add a profile</button>{/snippet}
						</EmptyState>
					{/each}
					{#if data.profiles.length}
						<div class="flex flex-wrap items-center gap-2 bg-surface px-4 py-2.5 text-xs">
							<label for="try" class="text-muted-foreground">Try a repo</label>
							<input id="try" class="input h-7 max-w-56 font-mono text-xs" placeholder="owner/name" bind:value={tryRepo} />
							{#if tried !== undefined}<span class="text-muted-foreground">→ {#if tried}<b class="font-medium text-foreground">{tried.name}</b>{:else}no profile: picked by hand{/if}</span>{/if}
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<section id="github">
			<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 class="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight"><BrandIcon brand="github" />GitHub</h2>
					<p class="text-xs text-muted-foreground">For listing and cloning private repos, pushing branches and opening pull requests with <code class="font-mono">gh</code>.</p>
				</div>
				<div class="flex gap-2">
					{#if data.deviceFlow}<button class="btn btn-primary btn-sm" onclick={startDevice}><BrandIcon brand="github" class="size-4" />Sign in with GitHub</button>{/if}
					<button class="btn btn-secondary btn-sm" onclick={() => openToken(null)}><Plus />Add a token</button>
				</div>
			</div>
			<div class="card divide-y divide-border">
				{#each data.githubAccounts as a (a.id)}
					<div class="flex flex-wrap items-center gap-3 px-4 py-3">
						{#if a.avatarUrl}<img src={a.avatarUrl} alt="" class="size-9 shrink-0 rounded-full border border-border" />{/if}
						<div class="min-w-0 flex-1 basis-52">
							<p class="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium">
								{a.label ?? a.login}<span class="font-normal text-muted-foreground">{a.label ? a.login : a.name}</span>
								<span class="badge">{a.kind === 'oauth' ? 'Signed in' : 'Token'}</span>
							</p>
							<p class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
								{#each a.orgs as o (o)}<span class="badge"><Building2 />{o}</span>{:else}<span>No organizations visible</span>{/each}
								{#if a.scopes}<span class="font-mono text-[0.6875rem]">· {a.scopes}</span>{/if}
							</p>
						</div>
						<div class="ml-auto flex items-center gap-1">
							<button class="btn btn-ghost btn-icon btn-sm" title="Refresh organizations" onclick={() => refreshGithub(a)}><RefreshCw /></button>
							<button class="btn btn-ghost btn-sm" title="Ask GitHub what this token can see" onclick={() => openCheck(a)}>Check access</button>
							<button class="btn btn-ghost btn-icon btn-sm" title="Rename or replace the token" onclick={() => openToken(a)}><Pencil /></button>
							<button class="btn btn-ghost btn-icon btn-sm hover:text-danger" title="Disconnect" onclick={() => removeGithub(a)}><Trash2 /></button>
						</div>
					</div>
				{:else}
					<EmptyState title="No GitHub accounts" body="Public repos work without one. Add a token for private repos, pushing and pull requests.">
						{#snippet action()}<button class="btn btn-secondary btn-sm" onclick={() => openToken(null)}><Plus />Add a token</button>{/snippet}
					</EmptyState>
				{/each}
			</div>
		</section>

		<AwsAccounts logins={data.awsLogins} profiles={data.awsProfiles} admin={data.viewer?.admin ?? false} />
	</div>
</div>

<Dialog
	bind:open={adding}
	title={editing ? `Edit ${editing.name}` : step === 'pick' ? 'Add a model account' : `Add ${spec.label}`}
	description={step === 'pick' ? 'Where the model runs, and how sessions sign in to it.' : undefined}
	width="max-w-xl"
>
	{#if step === 'pick'}
		<div class="space-y-4">
			{#each GROUPS as g (g)}
				<div>
					<p class="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/80 uppercase">
						{#if GROUP_BRAND[g]}<BrandIcon brand={GROUP_BRAND[g]!} class="size-3" />{:else}<Cloud class="size-3" />{/if}{g}
					</p>
					<div class="divide-y divide-border overflow-hidden rounded-xl border border-border">
						{#each kindsIn(g) as [value, k] (value)}
							<button type="button" class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40 active:bg-accent/60" onclick={() => pickKind(value)}>
								<span class="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface text-foreground">
									{#if KIND_BRAND[value]}<BrandIcon brand={KIND_BRAND[value]!} />{:else}<Network class="size-4 text-muted-foreground" />{/if}
								</span>
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-2 text-[0.8125rem] font-medium">{k.label}{#if k.remoteControl}<span class="badge">Remote Control</span>{/if}</span>
									<span class="line-clamp-2 text-xs text-muted-foreground">{k.description}</span>
								</span>
								<ChevronRight class="size-4 shrink-0 text-muted-foreground" />
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<form id="add-account" class="space-y-4" onsubmit={saveAccount}>
			<div class="flex items-start gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
				<span class="min-w-0 flex-1">
					<span class="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium">
					{#if KIND_BRAND[kind]}<BrandIcon brand={KIND_BRAND[kind]!} />{/if}{spec.label}<AgentBadge agent={spec.agent} />
				</span>
					<span class="mt-0.5 block text-xs text-muted-foreground">{spec.description}</span>
				</span>
				{#if !editing}<button type="button" class="btn btn-ghost btn-sm -mr-1 shrink-0" onclick={() => (step = 'pick')}><ChevronLeft />Change</button>{/if}
			</div>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="sm:col-span-2">
					<label class="label" for="aname">Name</label>
					<input id="aname" class="input" placeholder="Personal, Work…" bind:value={name} />
				</div>
				{#each spec.fields as f (f.key)}
					<div class={f.multiline || f.options || f.key === 'baseUrl' ? 'sm:col-span-2' : ''}>
						<label class="label" for="f-{f.key}">{f.label}{#if !f.required}<span class="font-normal text-muted-foreground"> · optional</span>{/if}</label>
						{#if f.options}
							<select id="f-{f.key}" class="input" bind:value={fields[f.key]}>
								{#each f.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
							</select>
						{:else if f.multiline}
							<textarea
								id="f-{f.key}"
								class="input min-h-28 py-2 font-mono text-xs"
								placeholder={editing?.secrets.includes(f.key) ? 'Stored. Paste a new one to replace it.' : f.placeholder}
								bind:value={fields[f.key]}
							></textarea>
						{:else}
							<input
								id="f-{f.key}"
								class="input {f.secret || f.key.endsWith('Model') ? 'font-mono text-xs' : ''}"
								type={f.secret ? 'password' : 'text'}
								autocomplete="off"
								placeholder={f.secret && editing?.secrets.includes(f.key) ? '•••••••• stored; type to replace' : f.placeholder}
								bind:value={fields[f.key]}
							/>
						{/if}
						{#if f.help}<p class="mt-1 text-xs text-muted-foreground">{f.help}</p>{/if}
					</div>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">
				{#if spec.signIn}After saving, a terminal opens here to sign in. The sign-in stays in this account's folder on the server.
				{:else}Keys are stored encrypted and passed to {AGENT_LABEL[spec.agent]} as environment variables. Check sends a tiny request to make sure they work.{/if}
			</p>
			{#if formError}<p class="text-xs text-danger">{formError}</p>{/if}
		</form>
	{/if}
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (adding = false)}>Cancel</button>
		{#if step === 'form'}
			<button class="btn btn-primary" form="add-account" disabled={saving}>
				{#if saving}<LoaderCircle class="animate-spin" />{/if}{editing ? 'Save' : spec.signIn ? 'Add and sign in' : 'Add account'}
			</button>
		{/if}
	{/snippet}
</Dialog>

<Dialog
	bind:open={() => !!login, (v) => !v && !finishing && hideLogin()}
	title="{login ? SIGN_IN[login.agent].title : ''}{login ? ` · ${login.name}` : ''}"
	description={login ? SIGN_IN[login.agent].help : ''}
	width="max-w-4xl"
>
	<div class="flex h-[26rem] flex-col overflow-hidden rounded-xl border border-term-edge max-sm:h-[20rem]">
		<LinkBar links={loginLinks} code={loginCode} />
		{#if login && loginReady}
			<div class="min-h-0 flex-1"><Terminal bind:this={loginTerm} path="/ws/accounts/{login.id}/login" /></div>
		{:else}
			<div class="grid h-full place-items-center text-xs text-[#9aa3b2]" style="background: var(--term-bg)">
				<span class="flex items-center gap-2"><LoaderCircle class="size-4 animate-spin" />Starting the sign-in container…</span>
			</div>
		{/if}
	</div>
	<div class="mt-3 flex flex-wrap items-center gap-2">
		{#if loginLink}
			<a class="btn btn-primary btn-sm" href={loginLink} target="_blank" rel="noopener"><ExternalLink />Open the sign-in page</a>
		{/if}
		{#if login?.agent !== 'codex'}
			<!-- Claude and Gemini hand back a code to paste in; pasting into a terminal is fiddly on phones. -->
			<form class="flex min-w-56 flex-1 gap-2" onsubmit={sendPasted}>
				<input class="input h-9 font-mono text-xs" placeholder="Paste the code from the sign-in page" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={pasted} disabled={!loginReady} />
				<button class="btn btn-secondary h-9 shrink-0" disabled={!pasted.trim() || sending}>{#if sending}<LoaderCircle class="animate-spin" />{:else}<Send />{/if}Send</button>
			</form>
		{/if}
	</div>
	<p class="mt-2 text-xs text-muted-foreground">You can switch to the sign-in page and come back: closing this keeps the sign-in waiting for 30 minutes. The login is saved in this account's folder on the server and shared by its sessions.</p>
	{#snippet footer()}
		<button class="btn btn-ghost mr-auto" disabled={finishing || !loginReady} onclick={restartLogin}><RefreshCw />Start over</button>
		<button class="btn btn-primary" disabled={finishing} onclick={finishLogin}>
			{#if finishing}<LoaderCircle class="animate-spin" />{/if}Done
		</button>
	{/snippet}
</Dialog>

<Dialog bind:open={profileOpen} title={profileEditing ? `Edit ${profileEditing.name}` : 'Add a profile'} description="Sessions on matching repos start with this account, model and permissions." width="max-w-lg">
	<form id="profile" class="space-y-3" onsubmit={saveProfile}>
		<div>
			<label class="label" for="pname">Name</label>
			<input id="pname" class="input" placeholder="Work repos on Bedrock, Side projects on Codex…" bind:value={pf.name} required />
		</div>
		<div>
			<label class="label" for="prepos">Repos</label>
			<textarea id="prepos" class="input min-h-20 py-2 font-mono text-xs" placeholder={'acme/*\nme/side-project\n*-infra'} bind:value={pf.repos}></textarea>
			<p class="mt-1 text-xs text-muted-foreground">One per line, owner/name. <code class="font-mono">*</code> matches anything; <code class="font-mono">*</code> alone matches every repo.</p>
		</div>
		<div>
			<label class="label" for="pacct">Account</label>
			<select id="pacct" class="input" bind:value={pf.accountId} required>
				{#each data.accounts as a (a.id)}<option value={a.id}>{a.name} · {ACCOUNT_KINDS[a.kind].label}</option>{/each}
			</select>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="label" for="pmodel">Model</label>
				<ModelPicker id="pmodel" bind:value={pf.model} agent={pfAgent} kind={accountById.get(pf.accountId)?.kind} />
			</div>
			<div>
				<label class="label" for="pperm">Permissions</label>
				<select id="pperm" class="input" bind:value={pf.permissionMode}>
					{#each pfModes as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
				</select>
			</div>
		</div>
		{#if data.awsProfiles.length}
			<div>
				<span class="label flex items-center gap-1.5"><BrandIcon brand="bedrock" class="size-3.5" />AWS <span class="font-normal text-muted-foreground/70">(optional)</span></span>
				<AwsProfilePicker profiles={data.awsProfiles} value={pf.awsProfileIds} onchange={(ids) => (pf.awsProfileIds = ids)} />
				<p class="mt-1 text-xs text-muted-foreground">Sessions on these repos get these AWS credentials (New session shows them, and they can be changed there).</p>
			</div>
		{/if}
		{#if profileError}<p class="text-xs text-danger">{profileError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (profileOpen = false)}>Cancel</button>
		<button class="btn btn-primary" form="profile" disabled={saving}>{#if saving}<LoaderCircle class="animate-spin" />{/if}{profileEditing ? 'Save' : 'Add profile'}</button>
	{/snippet}
</Dialog>

<Dialog bind:open={() => !!checking_, (v) => !v && (checking_ = null)} title={checking_ ? `What GitHub says about ${githubLabel(checking_)}` : ''} description="GitHub's own answers to this token, as they come back." width="max-w-2xl">
	<form class="flex gap-2" onsubmit={runCheck}>
		<input class="input font-mono text-xs" placeholder="owner/name of a repo to check (optional)" spellcheck="false" bind:value={checkRepo} />
		<button class="btn btn-secondary shrink-0" disabled={checkBusy}>{#if checkBusy}<LoaderCircle class="animate-spin" />{:else}<RefreshCw />{/if}Check</button>
	</form>
	{#if checkError}<p class="mt-3 text-xs text-danger">{checkError}</p>{/if}
	{#if checkResult}
		<p class="mt-4 text-[0.8125rem]">{checkResult.kind} <code class="ml-1 font-mono text-xs text-muted-foreground">{checkResult.token}</code></p>
		<p class="text-xs text-muted-foreground">Compare the start and end with the token you meant to add.</p>
		<div class="mt-3 divide-y divide-border rounded-lg border border-border">
			{#each checkResult.checks as c (c.path)}
				<div class="space-y-1 px-3 py-2.5 text-xs">
					<p class="flex items-center gap-2">
						<span class="badge {c.status < 300 ? 'badge-success' : 'badge-danger'} font-mono">{c.status}</span>
						<span class="font-medium">{c.label}</span>
						<code class="ml-auto truncate font-mono text-[0.6875rem] text-muted-foreground">GET {c.path}</code>
					</p>
					<p class="break-words">{c.answer}</p>
					{#each Object.entries(c.headers) as [h, v] (h)}<p class="font-mono text-[0.6875rem] break-all text-muted-foreground">{h}: {v}</p>{/each}
				</div>
			{/each}
		</div>
	{/if}
</Dialog>

<Dialog bind:open={addingToken} title={editingGithub ? `Edit ${githubLabel(editingGithub)}` : 'Add a GitHub token'} width="max-w-xl">
	<form id="add-token" class="space-y-3" onsubmit={addToken}>
		<div>
			<label class="label" for="tlabel">Name</label>
			<input id="tlabel" class="input" placeholder="Work org, Personal, Read-only…" maxlength="80" bind:value={tokenLabel} />
			<p class="mt-1 text-xs text-muted-foreground">Shown when you pick a GitHub account. Optional; without one, the GitHub login is shown.</p>
		</div>
		{#if editingGithub}
			<p class="text-[0.8125rem] text-muted-foreground">To swap in a new token (say the old one expired), paste it below. Sessions and automations using this connection keep it.</p>
		{:else}
		<p class="text-[0.8125rem] text-muted-foreground">
			A <b class="font-medium text-foreground">fine-grained token</b> with access to the repos you want (Contents and Pull requests: read and write) or a
			<b class="font-medium text-foreground">classic token</b> with <code class="font-mono text-xs">repo</code>, <code class="font-mono text-xs">read:org</code> and
			<code class="font-mono text-xs">workflow</code>.
		</p>
		{/if}
		<a class="btn btn-secondary btn-sm" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener"><ExternalLink />Create a token on GitHub</a>
		<div>
			<label class="label" for="tok">{editingGithub ? 'New token' : 'Token'}</label>
			<input id="tok" class="input font-mono text-xs" type="password" autocomplete="off" placeholder={editingGithub ? 'Leave empty to keep the current token' : 'github_pat_… or ghp_…'} bind:value={token} required={!editingGithub} />
		</div>
		{#if tokenError}<p class="text-xs text-danger">{tokenError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (addingToken = false)}>Cancel</button>
		<button class="btn btn-primary" form="add-token" disabled={saving}>{#if saving}<LoaderCircle class="animate-spin" />{/if}{editingGithub ? 'Save' : 'Connect'}</button>
	{/snippet}
</Dialog>

<Dialog bind:open={() => !!device, (v) => !v && ((device = null), clearTimeout(deviceTimer))} title="Sign in with GitHub" width="max-w-md">
	{#if device}
		<div class="space-y-4 text-center">
			<p class="text-[0.8125rem] text-muted-foreground">Enter this code at GitHub, then come back here.</p>
			<button class="mx-auto block rounded-xl border border-border bg-surface px-5 py-3 font-mono text-2xl font-semibold tracking-[0.2em]" title="Copy" onclick={() => copyText(device!.userCode)}>{device.userCode}</button>
			<a class="btn btn-primary" href={device.verificationUri} target="_blank" rel="noopener"><ExternalLink />Open github.com/login/device</a>
			<p class="flex items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle class="size-3.5 animate-spin" />Waiting for approval…</p>
		</div>
	{/if}
</Dialog>
