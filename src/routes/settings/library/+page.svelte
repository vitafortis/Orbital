<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { FolderGit2, Globe, LoaderCircle, MessageSquareText, Pencil, Plug, Plus, RefreshCw, SquareTerminal, Trash2, Wand } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import BrandIcon from '#lib/components/BrandIcon.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import SettingsTabs from '#lib/components/SettingsTabs.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { confirmAction, toast } from '#lib/client/state.svelte.ts';
	import { ago } from '#lib/client/format.ts';
	import type { LibrarySkill, McpKind, McpServer } from '#lib/types.ts';
	import type { PageProps } from './$types';

	/**
	 * What every Claude session gets, managed in one place. For now, MCP servers: Notion through
	 * an integration token, or any server by command or URL, given to sessions at launch.
	 */
	let { data }: PageProps = $props();
	const admin = $derived(data.viewer?.admin ?? false);
	const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? 'a removed account';

	const KINDS: { value: McpKind; label: string }[] = [
		{ value: 'notion', label: 'Notion' },
		{ value: 'stdio', label: 'Command' },
		{ value: 'http', label: 'URL' }
	];

	// ── the form ──
	let open = $state(false);
	let editing = $state<McpServer | null>(null);
	let f = $state({ kind: 'notion' as McpKind, name: 'notion', token: '', command: '', args: '', env: '', url: '', headers: '', accountIds: [] as string[], enabled: true });
	let busy = $state(false);
	let formError = $state('');

	function openForm(s: McpServer | null) {
		editing = s;
		f = s
			? { kind: s.kind, name: s.name, token: '', command: s.command ?? '', args: s.args.join('\n'), env: '', url: s.url ?? '', headers: '', accountIds: [...s.accountIds], enabled: s.enabled }
			: { kind: 'notion', name: data.servers.some((x) => x.name === 'notion') ? '' : 'notion', token: '', command: '', args: '', env: '', url: '', headers: '', accountIds: [], enabled: true };
		formError = '';
		open = true;
	}

	/** "KEY=value" (or "Header: value") lines as pairs; undefined when left empty (keep what's stored). */
	function parsePairs(text: string, sep: '=' | ':'): Record<string, string> | undefined {
		const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
		if (!lines.length) return undefined;
		const out: Record<string, string> = {};
		for (const l of lines) {
			const i = l.indexOf(sep);
			if (i < 1) throw new Error(`"${l}" needs a ${sep === '=' ? 'NAME=value' : 'Name: value'} form`);
			out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
		}
		return out;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		formError = '';
		try {
			const body = {
				name: f.name.trim(),
				kind: f.kind,
				accountIds: f.accountIds,
				enabled: f.enabled,
				...(f.kind === 'notion' ? { token: f.token.trim() || undefined } : {}),
				...(f.kind === 'stdio' ? { command: f.command.trim(), args: f.args.split('\n').map((a) => a.trim()).filter(Boolean), env: parsePairs(f.env, '=') } : {}),
				...(f.kind === 'http' ? { url: f.url.trim(), headers: parsePairs(f.headers, ':') } : {})
			};
			if (editing) await api.patch(`/api/library/mcp/${editing.id}`, body);
			else await api.post('/api/library/mcp', body);
			toast('success', editing ? `Saved ${body.name}` : `Added ${body.name}`, 'Sessions get it when Claude next starts: start a session, or Session → Restart Claude.');
			open = false;
			await invalidateAll();
		} catch (err) {
			formError = errorMessage(err);
		}
		busy = false;
	}

	async function setEnabled(s: McpServer, enabled: boolean) {
		try {
			await api.patch(`/api/library/mcp/${s.id}`, { name: s.name, kind: s.kind, command: s.command, args: s.args, url: s.url, accountIds: s.accountIds, enabled });
			await invalidateAll();
		} catch (err) {
			toast('error', `Couldn't change ${s.name}`, errorMessage(err));
		}
	}

	async function remove(s: McpServer) {
		const ok = await confirmAction({ title: `Remove ${s.name}?`, body: 'Sessions stop getting it when Claude next starts. Orbital forgets its secrets.', confirmLabel: 'Remove', danger: true });
		if (!ok) return;
		try {
			await api.del(`/api/library/mcp/${s.id}`);
			await invalidateAll();
		} catch (err) {
			toast('error', `Couldn't remove ${s.name}`, errorMessage(err));
		}
	}

	// ── your Notion: sessions you start reach Notion as you ──
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

	// ── skills ──
	const SKILL_TEMPLATE = '---\nname: my-skill\ndescription: What it does, and when Claude should use it.\n---\n\nWhat to do, step by step. $ARGUMENTS is what follows the command (a PR number, say).\n';
	let skillOpen = $state(false);
	let editingSkill = $state<LibrarySkill | null>(null);
	let sk = $state({ source: 'repo' as LibrarySkill['source'], name: '', description: '', body: '', repo: '', ref: '', path: '', githubAccountId: '', accountIds: [] as string[], enabled: true });
	let skillBusy = $state(false);
	let skillError = $state('');
	function openSkill(s: LibrarySkill | null) {
		editingSkill = s;
		sk = s
			? { source: s.source, name: s.name, description: s.description, body: s.body ?? '', repo: s.repo ?? '', ref: s.ref ?? '', path: s.path ?? '', githubAccountId: s.githubAccountId ?? '', accountIds: [...s.accountIds], enabled: s.enabled }
			: { source: 'repo', name: '', description: '', body: SKILL_TEMPLATE, repo: '', ref: '', path: '', githubAccountId: data.githubAccounts[0]?.id ?? '', accountIds: [], enabled: true };
		skillError = '';
		skillOpen = true;
	}
	async function readSkillFile(e: Event & { currentTarget: HTMLInputElement }) {
		const f = e.currentTarget.files?.[0];
		if (!f) return;
		sk.body = await f.text();
		if (!sk.name) sk.name = (/^name:\s*(\S+)/m.exec(sk.body)?.[1] ?? '').toLowerCase();
	}
	async function saveSkill(e: SubmitEvent) {
		e.preventDefault();
		skillBusy = true;
		skillError = '';
		try {
			const body = { ...sk, name: sk.name.trim(), ref: sk.ref.trim() || null, path: sk.path.trim() || null, githubAccountId: sk.githubAccountId || null, description: sk.description.trim() || null };
			const r = editingSkill ? await api.patch<LibrarySkill>(`/api/library/skills/${editingSkill.id}`, body) : await api.post<LibrarySkill>('/api/library/skills', body);
			skillOpen = false;
			toast('success', `${editingSkill ? 'Saved' : 'Added'} /${r.name}`, r.synced ? `Fetched ${r.synced.files} file${r.synced.files === 1 ? '' : 's'} from ${r.repo}. Sessions get it when Claude next starts.` : 'Sessions get it when Claude next starts.');
			await invalidateAll();
		} catch (err) {
			skillError = errorMessage(err);
		}
		skillBusy = false;
	}
	let syncing = $state<string | null>(null);
	async function syncSkill(s: LibrarySkill) {
		syncing = s.id;
		try {
			const r = await api.post<LibrarySkill>(`/api/library/skills/${s.id}/sync`);
			toast('success', `Fetched /${s.name}`, `${r.synced?.files} file${r.synced?.files === 1 ? '' : 's'}, from ${r.synced?.sha?.slice(0, 7)}.`);
		} catch (err) {
			toast('error', `Couldn't fetch /${s.name}`, errorMessage(err));
		}
		await invalidateAll();
		syncing = null;
	}
	async function setSkillEnabled(s: LibrarySkill, enabled: boolean) {
		await api.patch(`/api/library/skills/${s.id}`, { ...s, enabled }).catch((err) => toast('error', `Couldn't change /${s.name}`, errorMessage(err)));
		await invalidateAll();
	}
	async function removeSkill(s: LibrarySkill) {
		const ok = await confirmAction({ title: `Remove /${s.name}?`, body: 'Sessions stop getting it when Claude next starts.', confirmLabel: 'Remove', danger: true });
		if (!ok) return;
		await api.del(`/api/library/skills/${s.id}`).catch((err) => toast('error', `Couldn't remove /${s.name}`, errorMessage(err)));
		await invalidateAll();
	}

	// ── reply style ──
	let style = $state(untrack(() => ({ ...data.replyStyle })));
	let styleSaving = $state(false);
	const styleChanged = $derived(style.enabled !== data.replyStyle.enabled || style.text.trim() !== data.replyStyle.text.trim());
	async function saveStyle() {
		styleSaving = true;
		try {
			style = await api.put('/api/library/reply-style', style);
			toast('success', 'Saved the reply style', 'Sessions use it when Claude next starts.');
			await invalidateAll();
		} catch (err) {
			toast('error', "Couldn't save it", errorMessage(err));
		}
		styleSaving = false;
	}

	function what(s: McpServer): string {
		if (s.kind === 'notion') return s.notion?.bot ? `Integration “${s.notion.bot}”${s.notion.workspace ? ` in ${s.notion.workspace}` : ''}` : 'Notion integration';
		if (s.kind === 'stdio') return [s.command, ...s.args].join(' ');
		return s.url ?? '';
	}
</script>

<svelte:head><title>Library · Orbital</title></svelte:head>

<div class="h-full overflow-y-auto">
	<SettingsTabs admin={data.viewer?.admin ?? false} description="What every Claude session gets, set up once: how it writes, skills, and tools to connect to." />

	<div class="space-y-8 px-4 pb-10 sm:px-8">
		<section id="notion">
			<div class="mb-3">
				<h2 class="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight"><BrandIcon brand="notion" />Your Notion</h2>
				<p class="max-w-2xl text-xs text-muted-foreground">
					Sign in to Notion, and Claude in the sessions you start reaches it as you: everything you can see, with edits under your name. Only your sessions get it; it's yours, not the team's (for that, an admin adds Notion below as an integration).
				</p>
			</div>
			<div class="card flex flex-wrap items-center gap-3 px-4 py-3">
				{#if data.myNotion}
					<div class="min-w-0 flex-1 basis-60 text-[0.8125rem]">
						<p class="font-medium">Connected</p>
						<p class="text-xs {data.myNotion.renewError ? 'text-warning' : 'text-muted-foreground'}">
							{data.myNotion.renewError ?? `Since ${new Date(data.myNotion.createdAt).toLocaleDateString()}. Renews itself; sessions you start get it as notion.`}
						</p>
					</div>
					{#if data.myNotion.renewError}<button class="btn btn-secondary btn-sm" disabled={notionBusy} onclick={connectNotion}>Connect again</button>{/if}
					<button class="btn btn-ghost btn-sm hover:text-danger" onclick={disconnectNotion}>Disconnect</button>
				{:else}
					<p class="min-w-0 flex-1 basis-60 text-xs text-muted-foreground">Not connected. You'll sign in on Notion's page and choose what to allow, then come back here.</p>
					<button class="btn btn-primary btn-sm" disabled={notionBusy} onclick={connectNotion}>{#if notionBusy}<LoaderCircle class="animate-spin" />{:else}<BrandIcon brand="notion" class="size-4" />{/if}Connect my Notion</button>
				{/if}
			</div>
			<p class="mt-2 text-xs text-muted-foreground">Applies when Claude next starts in your sessions (start one, or Session → Restart Claude). Sessions started before this release, or by automations, have no owner and don't get it.</p>
		</section>

		<section>
			<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 class="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight"><MessageSquareText class="size-4" />Reply style</h2>
					<p class="max-w-2xl text-xs text-muted-foreground">
						Added to Claude's instructions in every session, so long conversations stay easy to follow: the outcome first, then what needs you, then short details. Steps for you go on the To do list.
					</p>
				</div>
				<Switch checked={style.enabled} label="Reply style on" disabled={!admin} onchange={(v) => (style.enabled = v)} />
			</div>
			<div class="card space-y-2 p-3 {style.enabled ? '' : 'opacity-60'}">
				<textarea class="input min-h-40 text-[0.8125rem] leading-relaxed" aria-label="Reply style" bind:value={style.text} disabled={!admin || !style.enabled}></textarea>
				{#if admin}
					<div class="flex flex-wrap items-center justify-end gap-2">
						{#if style.text.trim() !== data.defaultReplyStyle}<button class="btn btn-ghost btn-sm" onclick={() => (style.text = data.defaultReplyStyle)}>Back to Orbital's</button>{/if}
						<button class="btn btn-primary btn-sm" disabled={!styleChanged || styleSaving} onclick={saveStyle}>{#if styleSaving}<LoaderCircle class="animate-spin" />{/if}Save</button>
					</div>
				{/if}
			</div>
			<p class="mt-2 text-xs text-muted-foreground">Applies when Claude next starts in a session. Codex and Gemini sessions don't get it.</p>
		</section>

		<section id="skills">
			<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 class="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight"><Wand class="size-4" />Skills</h2>
					<p class="max-w-2xl text-xs text-muted-foreground">
						Skills every Claude session gets, whatever repo or branch it has checked out: written here, or a skill folder in a repo, fetched from its default branch (or one you name), so a pull request under review can't change the skill reviewing it. They show under Run a skill.
					</p>
				</div>
				{#if admin}<button class="btn btn-secondary btn-sm" onclick={() => openSkill(null)}><Plus />Add a skill</button>{/if}
			</div>
			<div class="card divide-y divide-border">
				{#each data.skills as s (s.id)}
					<div class="flex flex-wrap items-center gap-3 px-4 py-3 {s.enabled ? '' : 'opacity-60'}">
						{#if s.source === 'repo'}<FolderGit2 class="size-4 shrink-0 text-muted-foreground" />{:else}<Wand class="size-4 shrink-0 text-muted-foreground" />{/if}
						<div class="min-w-0 flex-1 basis-60">
							<p class="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium">
								<span class="font-mono">/{s.name}</span>
								<span class="badge">{s.source === 'repo' ? `${s.repo}${s.ref ? ` @ ${s.ref}` : ''}` : 'Written here'}</span>
								{#if !s.enabled}<span class="badge">Off</span>{/if}
							</p>
							{#if s.description}<p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>{/if}
							<p class="mt-0.5 text-xs {s.synced?.error ? 'text-warning' : 'text-muted-foreground'}">
								{#if s.source === 'repo'}
									<span class="font-mono">{s.path}</span> ·
									{#if s.synced?.error}{s.synced.error}{:else if s.synced}{s.synced.files} file{s.synced.files === 1 ? '' : 's'} from <span class="font-mono">{s.synced.sha?.slice(0, 7)}</span>, checked {ago(s.synced.at)}{:else}not fetched yet{/if} ·
								{/if}
								{s.accountIds.length ? s.accountIds.map(accountName).join(', ') : 'Every Claude account'}
							</p>
						</div>
						{#if admin}
							<div class="ml-auto flex items-center gap-2">
								{#if s.source === 'repo'}<button class="btn btn-ghost btn-icon btn-sm" title="Fetch it again now" disabled={syncing === s.id} onclick={() => syncSkill(s)}>{#if syncing === s.id}<LoaderCircle class="animate-spin" />{:else}<RefreshCw />{/if}</button>{/if}
								<Switch checked={s.enabled} label="On" onchange={(v) => setSkillEnabled(s, v)} />
								<button class="btn btn-ghost btn-icon btn-sm" title="Edit" onclick={() => openSkill(s)}><Pencil /></button>
								<button class="btn btn-ghost btn-icon btn-sm hover:text-danger" title="Remove" onclick={() => removeSkill(s)}><Trash2 /></button>
							</div>
						{/if}
					</div>
				{:else}
					<EmptyState icon={Wand} title="No skills yet" body={admin ? 'Add one from a repo (e.g. .claude/skills/appsec-pr-review on the default branch), or write one here.' : 'An admin can add them here.'}>
						{#snippet action()}{#if admin}<button class="btn btn-secondary btn-sm" onclick={() => openSkill(null)}><Plus />Add a skill</button>{/if}{/snippet}
					</EmptyState>
				{/each}
			</div>
			<p class="mt-2 text-xs text-muted-foreground">Installed into each Claude account's skills when one of its sessions starts (repo skills are fetched first, if their branch moved). A skill the account already has under the same name, made by hand, is left as it is.</p>
		</section>

		<section>
			<div class="mb-3">
				<h2 class="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight"><Plug class="size-4" />MCP servers
					{#if admin && data.servers.length}<button class="btn btn-secondary btn-sm ml-auto" onclick={() => openForm(null)}><Plus />Add a server</button>{/if}</h2>
				<p class="max-w-2xl text-xs text-muted-foreground">
					Claude Code connects to these in every session they're for, with the secrets kept here: Notion, Sentry, a database, your own tools. A change applies when Claude next starts. Codex and Gemini sessions don't get them.
				</p>
			</div>

			<div class="card divide-y divide-border">
				{#each data.servers as s (s.id)}
					<div class="flex flex-wrap items-center gap-3 px-4 py-3 {s.enabled ? '' : 'opacity-60'}">
						{#if s.kind === 'notion'}<BrandIcon brand="notion" />{:else if s.kind === 'stdio'}<SquareTerminal class="size-4 shrink-0 text-muted-foreground" />{:else}<Globe class="size-4 shrink-0 text-muted-foreground" />{/if}
						<div class="min-w-0 flex-1 basis-52">
							<p class="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium">
								<span class="font-mono">{s.name}</span>
								<span class="badge">{KINDS.find((k) => k.value === s.kind)?.label}</span>
								{#if !s.enabled}<span class="badge">Off</span>{/if}
							</p>
							<p class="mt-0.5 truncate text-xs text-muted-foreground {s.kind === 'notion' ? '' : 'font-mono'}" title={what(s)}>{what(s)}</p>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{s.accountIds.length ? s.accountIds.map(accountName).join(', ') : 'Every Claude account'}{#if s.secretKeys.length && s.kind !== 'notion'}{' · '}secrets: <span class="font-mono">{s.secretKeys.join(', ')}</span>{/if}
							</p>
						</div>
						{#if admin}
							<div class="ml-auto flex items-center gap-2">
								<Switch checked={s.enabled} label="On" onchange={(v) => setEnabled(s, v)} />
								<button class="btn btn-ghost btn-icon btn-sm" title="Edit" onclick={() => openForm(s)}><Pencil /></button>
								<button class="btn btn-ghost btn-icon btn-sm hover:text-danger" title="Remove" onclick={() => remove(s)}><Trash2 /></button>
							</div>
						{/if}
					</div>
				{:else}
					<EmptyState icon={Plug} title="No MCP servers yet" body={admin ? 'Start with Notion: sessions can then read and write the pages you share with its integration.' : 'An admin can add them here.'}>
						{#snippet action()}{#if admin}<button class="btn btn-secondary btn-sm" onclick={() => openForm(null)}><BrandIcon brand="notion" class="size-4" />Connect Notion</button>{/if}{/snippet}
					</EmptyState>
				{/each}
			</div>
			{#if !admin && data.servers.length}<p class="mt-2 text-xs text-muted-foreground">Only an admin can change the Library.</p>{/if}
		</section>
	</div>
</div>

<Dialog bind:open title={editing ? `Edit ${editing.name}` : 'Add an MCP server'} width="max-w-lg">
	<form id="mcp-form" class="space-y-3" onsubmit={save}>
		<div class="flex rounded-lg border border-border bg-background p-0.5 text-xs">
			{#each KINDS as k (k.value)}
				<button type="button" class="flex-1 rounded-md px-2.5 py-1 {f.kind === k.value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'}" onclick={() => (f.kind = k.value)}>{k.label}</button>
			{/each}
		</div>

		{#if f.kind === 'notion'}
			<ol class="list-decimal space-y-1 rounded-lg border border-border bg-surface py-2.5 pr-3 pl-7 text-xs text-muted-foreground">
				<li>In Notion, open <a class="text-primary underline" href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener">Integrations</a> and make a new <span class="text-foreground">internal</span> integration (call it “Orbital”).</li>
				<li>Copy its <span class="text-foreground">Internal Integration Secret</span> and paste it below.</li>
				<li>On each page or database sessions may use: <span class="text-foreground">••• → Connections → Orbital</span>. It sees nothing else.</li>
			</ol>
			<div>
				<label class="label" for="mcp-token">Integration secret</label>
				<input id="mcp-token" class="input font-mono text-[0.8125rem]" type="password" autocomplete="off" placeholder={editing?.kind === 'notion' ? 'Unchanged. Paste a new one to replace it' : 'ntn_…'} bind:value={f.token} required={!editing || editing.kind !== 'notion'} />
				<p class="mt-1 text-xs text-muted-foreground">Sessions act as the integration, not as you: its edits show under its name.</p>
			</div>
		{:else if f.kind === 'stdio'}
			<div>
				<label class="label" for="mcp-command">Command</label>
				<input id="mcp-command" class="input font-mono text-[0.8125rem]" placeholder="npx" bind:value={f.command} required />
			</div>
			<div>
				<label class="label" for="mcp-args">Arguments <span class="font-normal text-muted-foreground/70">(one per line)</span></label>
				<textarea id="mcp-args" class="input min-h-16 font-mono text-[0.8125rem]" placeholder={'-y\n@modelcontextprotocol/server-postgres'} bind:value={f.args}></textarea>
			</div>
			<div>
				<label class="label" for="mcp-env">Environment <span class="font-normal text-muted-foreground/70">(NAME=value per line, kept encrypted)</span></label>
				<textarea id="mcp-env" class="input min-h-16 font-mono text-[0.8125rem]" placeholder={editing?.secretKeys.length && editing.kind === 'stdio' ? `Unchanged (${editing.secretKeys.join(', ')}). Type them all to replace` : 'DATABASE_URL=postgres://…'} bind:value={f.env}></textarea>
			</div>
			<p class="text-xs text-muted-foreground">It runs inside each session's container, so the command must be there (npx and uvx-style launchers fetch the server).</p>
		{:else}
			<div>
				<label class="label" for="mcp-url">URL</label>
				<input id="mcp-url" class="input font-mono text-[0.8125rem]" placeholder="https://mcp.example.com/mcp" bind:value={f.url} required />
			</div>
			<div>
				<label class="label" for="mcp-headers">Headers <span class="font-normal text-muted-foreground/70">(Name: value per line, kept encrypted)</span></label>
				<textarea id="mcp-headers" class="input min-h-16 font-mono text-[0.8125rem]" placeholder={editing?.secretKeys.length && editing.kind === 'http' ? `Unchanged (${editing.secretKeys.join(', ')}). Type them all to replace` : 'Authorization: Bearer …'} bind:value={f.headers}></textarea>
			</div>
			<p class="text-xs text-muted-foreground">For servers that take a token in a header. Ones that sign in through a browser (OAuth) can't complete it from a container.</p>
		{/if}

		<div>
			<label class="label" for="mcp-name">Name in Claude</label>
			<input id="mcp-name" class="input font-mono text-[0.8125rem]" placeholder="notion" bind:value={f.name} required />
			<p class="mt-1 text-xs text-muted-foreground">Its tools show as <code class="font-mono">mcp__{f.name || 'name'}__…</code>.</p>
		</div>

		{#if data.accounts.length > 1}
			<fieldset>
				<legend class="label">For sessions on</legend>
				<div class="space-y-1.5">
					{#each data.accounts as a (a.id)}
						<label class="flex items-center gap-2 text-[0.8125rem]">
							<input
								type="checkbox"
								checked={f.accountIds.includes(a.id)}
								onchange={(e) => (f.accountIds = e.currentTarget.checked ? [...f.accountIds, a.id] : f.accountIds.filter((x) => x !== a.id))}
							/>{a.name}
						</label>
					{/each}
				</div>
				<p class="mt-1 text-xs text-muted-foreground">{f.accountIds.length ? 'Only these accounts’ sessions get it.' : 'None ticked: every Claude account’s sessions get it.'}</p>
			</fieldset>
		{/if}
		{#if formError}<p class="text-xs text-danger">{formError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (open = false)}>Cancel</button>
		<button class="btn btn-primary" form="mcp-form" disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{/if}{editing ? 'Save' : f.kind === 'notion' ? 'Connect Notion' : 'Add server'}</button>
	{/snippet}
</Dialog>

<Dialog bind:open={skillOpen} title={editingSkill ? `Edit /${editingSkill.name}` : 'Add a skill'} width="max-w-2xl">
	<form id="skill-form" class="space-y-3" onsubmit={saveSkill}>
		<div class="flex rounded-lg border border-border bg-background p-0.5 text-xs">
			{#each [{ value: 'repo', label: 'From a repo' }, { value: 'here', label: 'Write it here' }] as const as o (o.value)}
				<button type="button" class="flex-1 rounded-md px-2.5 py-1 {sk.source === o.value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'}" onclick={() => (sk.source = o.value)}>{o.label}</button>
			{/each}
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label class="label" for="sk-name">Command</label>
				<div class="relative">
					<span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-[0.8125rem] text-muted-foreground">/</span>
					<input id="sk-name" class="input pl-6 font-mono text-[0.8125rem]" placeholder="appsec-pr-review" bind:value={sk.name} required autocomplete="off" spellcheck="false" />
				</div>
			</div>
			<div>
				<label class="label" for="sk-desc">Description <span class="font-normal text-muted-foreground/70">{sk.source === 'here' ? '(or in the front matter)' : '(optional)'}</span></label>
				<input id="sk-desc" class="input" placeholder="Security review of a pull request" bind:value={sk.description} />
			</div>
		</div>
		{#if sk.source === 'repo'}
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class="label" for="sk-repo">Repository</label>
					<input id="sk-repo" class="input font-mono text-[0.8125rem]" placeholder="Ironclad/ironclad" bind:value={sk.repo} required autocomplete="off" spellcheck="false" />
				</div>
				<div>
					<label class="label" for="sk-ref">Branch <span class="font-normal text-muted-foreground/70">(empty: the default branch)</span></label>
					<input id="sk-ref" class="input font-mono text-[0.8125rem]" placeholder="main" bind:value={sk.ref} autocomplete="off" spellcheck="false" />
				</div>
			</div>
			<div>
				<label class="label" for="sk-path">Skill folder in the repo</label>
				<input id="sk-path" class="input font-mono text-[0.8125rem]" placeholder={`.claude/skills/${sk.name || 'appsec-pr-review'}`} bind:value={sk.path} autocomplete="off" spellcheck="false" />
				<p class="mt-1 text-xs text-muted-foreground">The folder with its SKILL.md (everything in it comes too), or one .md file. Empty: <span class="font-mono">.claude/skills/&lt;command&gt;</span>.</p>
			</div>
			{#if data.githubAccounts.length}
				<div>
					<label class="label" for="sk-gh">Read it with</label>
					<select id="sk-gh" class="input" bind:value={sk.githubAccountId}>
						<option value="">No GitHub connection (a public repo)</option>
						{#each data.githubAccounts as g (g.id)}<option value={g.id}>{g.label === g.login ? g.login : `${g.label} · ${g.login}`}</option>{/each}
					</select>
				</div>
			{/if}
		{:else}
			<div>
				<label class="label flex items-center justify-between" for="sk-body">
					SKILL.md
					<span class="font-normal text-primary"><input type="file" accept=".md,text/markdown" class="hidden" id="sk-file" onchange={readSkillFile} /><label for="sk-file" class="cursor-pointer hover:underline">Choose a file</label></span>
				</label>
				<textarea id="sk-body" class="input min-h-64 font-mono text-[0.75rem] leading-relaxed" bind:value={sk.body} required spellcheck="false"></textarea>
				<p class="mt-1 text-xs text-muted-foreground">The front matter's name is set to the command. $ARGUMENTS is what follows the command, e.g. the PR number from Run a skill.</p>
			</div>
		{/if}
		{#if data.accounts.length > 1}
			<fieldset>
				<legend class="label">For sessions on</legend>
				<div class="space-y-1.5">
					{#each data.accounts as a (a.id)}
						<label class="flex items-center gap-2 text-[0.8125rem]">
							<input type="checkbox" checked={sk.accountIds.includes(a.id)} onchange={(e) => (sk.accountIds = e.currentTarget.checked ? [...sk.accountIds, a.id] : sk.accountIds.filter((x) => x !== a.id))} />{a.name}
						</label>
					{/each}
				</div>
				<p class="mt-1 text-xs text-muted-foreground">{sk.accountIds.length ? 'Only these accounts’ sessions get it.' : 'None ticked: every Claude account’s sessions get it.'}</p>
			</fieldset>
		{/if}
		{#if skillError}<p class="text-xs text-danger">{skillError}</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (skillOpen = false)}>Cancel</button>
		<button class="btn btn-primary" form="skill-form" disabled={skillBusy}>{#if skillBusy}<LoaderCircle class="animate-spin" />{/if}{editingSkill ? 'Save' : sk.source === 'repo' ? 'Fetch and add' : 'Add skill'}</button>
	{/snippet}
</Dialog>
