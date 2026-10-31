<script lang="ts">
	import {
		ArrowDown,
		ArrowDownToLine,
		ArrowUp,
		ChevronDown,
		ChevronUp,
		CircleAlert,
		CircleStop,
		Copy,
		CornerDownLeft,
		ExternalLink,
		FilePlus2,
		GitBranch,
		History,
		Keyboard,
		ListTodo,
		LoaderCircle,
		MoreHorizontal,
		PanelRightClose,
		PanelRightOpen,
		Pencil,
		Play,
		RotateCcw,
		Sparkles,
		SquareTerminal,
		TerminalSquare,
		Trash2,
		Wand,
	} from '@lucide/svelte';
	import Conversations from '#lib/components/Conversations.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import Menu from '#lib/components/Menu.svelte';
	import StateBadge from '#lib/components/StateBadge.svelte';
	import SessionTags from '#lib/components/SessionTags.svelte';
	import StateDot from '#lib/components/StateDot.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import LinkBar from '#lib/components/LinkBar.svelte';
	import AwsProfilePicker from '#lib/components/AwsProfilePicker.svelte';
	import BrandIcon from '#lib/components/BrandIcon.svelte';
	import Terminal from '#lib/components/Terminal.svelte';
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { api, errorMessage } from '#lib/client/api.ts';
	import { copyText } from '#lib/client/clipboard.ts';
	import { ago, githubLabel } from '#lib/client/format.ts';
	import { deleteSession, relaunchAgent, sendToSession, startSession, stopSession, type Launch } from '#lib/client/sessions.ts';
	import QuestionBar from '#lib/components/QuestionBar.svelte';
	import ModelPicker from '#lib/components/ModelPicker.svelte';
	import PanelSection from '#lib/components/PanelSection.svelte';
	import { CLAUDE_ALIASES, modelLabel } from '#lib/models.ts';
	import { findQuestion, type Question } from '#lib/pane.ts';
	import { confirmAction, deletedHere, sessions, toast, upsertSession, useSessions } from '#lib/client/state.svelte.ts';
	import { displayState, glowClass } from '#lib/session-state.ts';
	import { repoLabel, sessionWorkdir } from '#lib/launch.ts';
	import { ACCOUNT_KINDS, AGENT_LABEL, AGENT_PERMISSION_MODES } from '#lib/providers.ts';
	import { PERMISSION_MODES, type Conversation, type Session, type SessionLive, type SkillOption } from '#lib/types.ts';
	import type { PageProps } from './$types';

	const shown = useSessions();

	let { data }: PageProps = $props();

	const listed = $derived(shown.list.find((x) => x.id === data.session.id));
	// Not in the list: deleted, here or in another tab. The copy the page loaded with may still say
	// running, which would show it green and keep its terminal reconnecting; show it stopped instead.
	const s = $derived(listed ?? { ...data.session, status: 'stopped' as const, containerId: null });
	$effect(() => {
		// Deleting from this tab already toasts and navigates away.
		if (listed || deletedHere.has(data.session.id)) return;
		untrack(() => {
			toast('info', `${data.session.name} was deleted`);
			void goto('/', { replaceState: true });
		});
	});
	const live = $derived(shown.live[s.id]);
	const view = $derived(displayState(s, live));
	const running = $derived(s.status === 'running');
	// The panel keeps the last summary and git state it had for this session: an update that
	// briefly lacks them would otherwise drop sections and make everything below jump.
	let kept = { id: '', sum: null as SessionLive['summary'], git: null as SessionLive['git'] };
	const sum = $derived.by(() => {
		if (kept.id !== s.id) kept = { id: s.id, sum: null, git: null };
		if (live?.summary) kept.sum = live.summary;
		return live?.summary ?? kept.sum;
	});
	const git = $derived.by(() => {
		if (kept.id !== s.id) kept = { id: s.id, sum: null, git: null };
		if (live?.git) kept.git = live.git;
		return live?.git ?? kept.git;
	});
	const account = $derived(data.accounts.find((a) => a.id === s.accountId));
	const rcAvailable = $derived(!!account && !!ACCOUNT_KINDS[account.kind].remoteControl);
	const isClaude = $derived(s.agent === 'claude');
	const agentName = $derived(isClaude ? 'Claude' : AGENT_LABEL[s.agent]);
	// Switching between agents would leave the conversations behind: keep to the same one.
	const sameAgentAccounts = $derived(data.accounts.filter((a) => a.agent === s.agent));
	const permissionModes = $derived(PERMISSION_MODES.filter((m) => AGENT_PERMISSION_MODES[s.agent].includes(m.value)));

	let mode = $state<'claude' | 'shell'>('claude');
	let panel = $state(true);
	let term = $state<Terminal>();
	let touch = $state(false);
	let phone = $state(false);
	// A menu the agent shows (permission prompt, question, picker), read off the terminal.
	let question = $state<Question | null>(null);
	$effect(() => {
		// The Shell tab's screen is the user's own.
		if (mode !== 'claude' || !running) question = null;
	});

	function answer(key: string) {
		if (term?.isOpen()) term.input(key === 'Escape' ? '\x1b' : key);
		else void sendToSession(s, { keys: [key] });
		term?.focus();
	}
	// The terminal's connection to the container, shown in the header.
	let conn = $state<'connecting' | 'open' | 'closed'>('connecting');
	const CONN = {
		connecting: { label: 'Connecting…', dot: 'bg-warning', pulse: true },
		open: { label: 'Connected', dot: 'bg-success', pulse: false },
		closed: { label: 'Disconnected', dot: 'bg-danger', pulse: true }
	} as const;
	let busy = $state(false);
	let summarizing = $state(false);

	// "Run a skill" types the command into Claude's prompt.
	let skillOpen = $state(false);
	let skills = $state<SkillOption[]>([]);
	let skillCommand = $state('/code-review');
	let skillArgs = $state('');

	async function openSkill() {
		skillOpen = true;
		skills = await api.get<SkillOption[]>(`/api/skills?account=${s.accountId}`).catch(() => []);
	}

	async function runSkill(e: SubmitEvent) {
		e.preventDefault();
		const line = `${skillCommand.trim()} ${skillArgs.trim()}`.trim();
		if (!line.startsWith('/')) return;
		if (await sendToSession(s, { text: line, enter: true })) {
			skillOpen = false;
			skillArgs = '';
			toast('success', `Sent ${line}`);
		}
	}

	const attachCommand = $derived(`docker exec -it -u node ${s.containerName} tmux attach -t main`);

	$effect(() => {
		// The panel stays as it was last left; at first, open only where there's room for it.
		let saved: string | null = null;
		try {
			saved = localStorage.getItem('orb.panel');
		} catch {}
		panel = saved ? saved === 'open' : matchMedia('(min-width: 1536px)').matches;
		// Touch screens get the key bar.
		touch = matchMedia('(pointer: coarse)').matches;
		phone = matchMedia('(max-width: 639px)').matches;
	});

	function togglePanel() {
		panel = !panel;
		try {
			localStorage.setItem('orb.panel', panel ? 'open' : 'closed');
		} catch {}
	}

	async function act(fn: () => Promise<unknown>) {
		busy = true;
		try {
			await fn();
		} finally {
			busy = false;
		}
	}

	function launch(l: Launch) {
		return act(() => (running ? relaunchAgent(s, l) : startSession(s, l)));
	}

	function resume(c: Conversation) {
		void launch({ mode: 'resume', conversationId: c.id });
	}

	async function summarize() {
		summarizing = true;
		try {
			const r = await api.post<{ text: string; at: string }>(`/api/sessions/${s.id}/summary`);
			if (sessions.live[s.id]) sessions.live[s.id].aiSummary = r;
		} catch (err) {
			toast('error', 'No summary', errorMessage(err));
		}
		summarizing = false;
	}

	async function patch(body: Partial<Session>) {
		try {
			upsertSession(await api.patch<Session>(`/api/sessions/${s.id}`, body));
			toast('success', 'Saved', running ? `Applies when ${agentName} restarts.` : undefined);
		} catch (err) {
			toast('error', "Couldn't save", errorMessage(err));
		}
	}

	/** AWS profiles apply at once: added ones work, removed ones stop working, no restart. */
	async function setAws(awsProfileIds: string[]) {
		try {
			upsertSession(await api.patch<Session>(`/api/sessions/${s.id}`, { awsProfileIds }));
			toast('success', 'AWS access changed', running ? 'The session has the new credentials now.' : undefined);
		} catch (err) {
			toast('error', "Couldn't change AWS access", errorMessage(err));
		}
	}

	// Renaming: the title becomes a text box; Enter (or leaving it) saves, Escape cancels.
	let renaming = $state(false);
	let newName = $state('');
	function startRename() {
		newName = s.name;
		renaming = true;
	}
	async function saveName() {
		if (!renaming) return;
		renaming = false;
		const name = newName.trim().replace(/\s+/g, ' ');
		if (!name || name === s.name) return;
		try {
			upsertSession(await api.patch<Session>(`/api/sessions/${s.id}`, { name }));
			toast('success', 'Renamed', isClaude && running ? `Claude's own name for the session (and Remote Control's) changes when it restarts.` : undefined);
		} catch (err) {
			toast('error', "Couldn't rename", errorMessage(err));
		}
	}
	const focusSelect = (el: HTMLInputElement) => {
		el.focus();
		el.select();
	};

	/** Saves the model and, while the agent runs, offers to restart it on the newest conversation. */
	async function changeModel(value: string) {
		const model = value || null;
		if (model === (s.model ?? null)) return;
		try {
			upsertSession(await api.patch<Session>(`/api/sessions/${s.id}`, { model }));
		} catch (err) {
			toast('error', "Couldn't change the model", errorMessage(err));
			return;
		}
		const label = model ? modelLabel(model) : 'the default model';
		if (!running) return toast('success', `Model: ${label}`, 'Used from the next start.');
		const midTurn = live?.state === 'working';
		const ok = await confirmAction({
			title: `Switch to ${label} now?`,
			body: `${agentName} restarts and carries on with the newest conversation${midTurn ? '. It is in the middle of a turn, which stops' : ''}. Otherwise the model applies from the next start.`,
			confirmLabel: 'Restart now'
		});
		if (ok) await launch({ mode: 'continue' });
		else toast('success', `Model: ${label}`, 'Used from the next start.');
	}

	// Keys for touch screens, as terminal input sequences.
	const KEYS: { label: string; seq: string; title: string }[] = [
		{ label: 'Esc', seq: '\x1b', title: 'Escape: interrupt the agent or close a menu' },
		{ label: 'Tab', seq: '\t', title: 'Tab' },
		{ label: '⇧Tab', seq: '\x1b[Z', title: 'Shift+Tab: cycle permission modes' },
		{ label: '↑', seq: '\x1b[A', title: 'Up' },
		{ label: '↓', seq: '\x1b[B', title: 'Down' },
		{ label: '^C', seq: '\x03', title: 'Ctrl+C' },
		{ label: 'End', seq: '\x1b[1;5F', title: 'Ctrl+End: back to the newest output' },
		{ label: '⏎', seq: '\r', title: 'Enter' }
	];

	// On phones the header's model chip and Remote button live in the Session menu.
	let modelSheet = $state(false);
	const restartItems = $derived([
		...(running && isClaude ? [{ label: 'Run a skill…', hint: 'Type a skill or command into Claude', icon: Wand, onclick: openSkill }, 'separator' as const] : []),
		...(phone && isClaude ? [{ label: 'Change model…', hint: modelLabel(s.model), icon: Sparkles, onclick: () => (modelSheet = true) }] : []),
		...(phone && s.rcUrl && running ? [{ label: 'Open in claude.ai', hint: 'Remote Control', icon: ExternalLink, onclick: () => window.open(s.rcUrl!, '_blank', 'noopener') }] : []),
		...(phone && isClaude ? ['separator' as const] : []),
		{ label: 'Rename…', icon: Pencil, onclick: startRename },
		'separator' as const,
		{ label: 'Continue newest conversation', hint: `Restart ${agentName} and pick up where it left off`, icon: RotateCcw, onclick: () => launch({ mode: 'continue' }) },
		{ label: 'New conversation', hint: 'Fresh context, same repo and branch', icon: FilePlus2, onclick: () => launch({ mode: 'new' }) },
		'separator' as const,
		{ label: running ? 'Stop session' : 'Start session', hint: running ? 'Keeps the repo and conversations' : 'Continue the newest conversation', icon: running ? CircleStop : Play, onclick: () => act(() => (running ? stopSession(s) : startSession(s))) },
		{ label: 'Delete session', icon: Trash2, danger: true, onclick: () => deleteSession(s) }
	]);
</script>

<svelte:head><title>{s.name} · Orbital</title></svelte:head>

<div class="flex h-full min-h-0 flex-col">
	<!-- Header -->
	<header class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2 sm:px-4">
		<StateDot state={view} />
		<!-- On phones the title gets its own row; the controls wrap below it. -->
		<div class="min-w-0 flex-1 max-sm:basis-[calc(100%-1.25rem)]">
			{#if renaming}
				<input
					class="-my-0.5 -ml-1.5 h-6 w-full max-w-md rounded-md border border-primary/60 bg-background px-1.5 text-[0.9375rem] leading-tight font-semibold tracking-tight outline-none"
					aria-label="Session name"
					maxlength="80"
					bind:value={newName}
					use:focusSelect
					onblur={saveName}
					onkeydown={(e) => {
						if (e.key === 'Enter') saveName();
						else if (e.key === 'Escape') renaming = false;
					}}
				/>
			{:else}
				<h1 class="group flex min-w-0 items-center gap-1.5">
					<button type="button" class="truncate text-left text-[0.9375rem] leading-tight font-semibold tracking-tight" title="Rename" onclick={startRename}>{s.name}</button>
					<button type="button" class="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-sm:hidden" title="Rename" aria-label="Rename session" onclick={startRename}><Pencil class="size-3.5" /></button>
				</h1>
			{/if}
			<p class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
				<span class="truncate">{repoLabel(s)}</span>
				{#if git?.branch ?? s.newBranch ?? s.baseBranch}
					<GitBranch class="size-3 shrink-0" /><span class="truncate font-mono text-[0.6875rem]">{git?.branch ?? s.newBranch ?? s.baseBranch}</span>
				{/if}
			</p>
		</div>
		<span class="max-md:hidden"><SessionTags session={s} /></span>
		<span class="max-sm:hidden"><StateBadge state={view} /></span>

		{#if running}
			<div class="flex rounded-lg border border-border bg-background p-0.5 text-xs">
				<button class="flex items-center gap-1.5 rounded-md px-2.5 py-1 {mode === 'claude' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'}" onclick={() => (mode = 'claude')}><TerminalSquare class="size-3.5" /><span class="max-sm:hidden">{agentName}</span></button>
				<button class="flex items-center gap-1.5 rounded-md px-2.5 py-1 {mode === 'shell' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'}" onclick={() => (mode = 'shell')}><SquareTerminal class="size-3.5" /><span class="max-sm:hidden">Shell</span></button>
			</div>
		{/if}
		{#if isClaude}
			<!-- Quick model switch: a native select, so phones get their own picker. -->
			<label class="relative flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground max-sm:hidden" title="Model: {modelLabel(s.model)}. Change it here">
				<Sparkles class="size-3.5" /><span class="max-w-28 truncate">{s.model ? modelLabel(s.model).replace(' (pinned)', '') : 'Default model'}</span><ChevronDown class="size-3" />
				<select class="absolute inset-0 cursor-pointer opacity-0" aria-label="Model" value={s.model ?? ''} onchange={(e) => changeModel(e.currentTarget.value)}>
					<option value="">Default model</option>
					{#each CLAUDE_ALIASES as m (m.value)}<option value={m.value}>{m.label} · {m.hint}</option>{/each}
					{#if s.model && !CLAUDE_ALIASES.some((m) => m.value === s.model)}<option value={s.model}>{modelLabel(s.model)}</option>{/if}
				</select>
			</label>
		{/if}
		{#if running}
			<span class="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground" title="The terminal's connection to the container: {CONN[conn].label}" aria-live="polite">
				<span class="relative inline-flex size-2 shrink-0">
					{#if CONN[conn].pulse}<span class="absolute inset-0 animate-ping rounded-full opacity-60 {CONN[conn].dot}"></span>{/if}
					<span class="relative size-2 rounded-full {CONN[conn].dot}"></span>
				</span>
				<span class="max-sm:sr-only">{CONN[conn].label}</span>
			</span>
		{/if}
		{#if s.rcUrl && running}
			<a class="btn btn-secondary btn-sm max-sm:hidden" href={s.rcUrl} target="_blank" rel="noopener" title="Open this session in claude.ai (Remote Control)"><BrandIcon brand="claude" class="size-3.5" />Remote</a>
		{/if}
		<Menu items={restartItems}>
			{#snippet trigger({ toggle })}
				<button class="btn btn-secondary btn-sm" onclick={toggle} disabled={busy}>
					{#if busy}<LoaderCircle class="animate-spin" />{:else}<MoreHorizontal />{/if}<span class="max-sm:hidden">Session</span><ChevronDown />
				</button>
			{/snippet}
		</Menu>
		<button class="btn btn-ghost btn-icon btn-sm" title={panel ? 'Hide details' : 'Show details'} onclick={togglePanel}>
			{#if panel}<PanelRightClose />{:else}<PanelRightOpen />{/if}
		</button>
	</header>

	<div class="relative flex min-h-0 flex-1">
		<!-- Terminal, or what to do when there isn't one -->
		<div class="flex min-w-0 flex-1 flex-col">
			{#if running && s.containerId}
				<!-- The agent's screen only: the Shell tab is a separate terminal the probe doesn't read. -->
				{#if mode === 'claude'}<LinkBar links={live?.links ?? []} />{/if}
				{#if question}<QuestionBar {question} {agentName} onanswer={(n) => answer(String(n))} oncancel={() => answer('Escape')} />{/if}
				<div class="relative min-h-0 flex-1">
					{#key `${s.containerId}:${mode}`}
						<Terminal bind:this={term} path="/ws/sessions/{s.id}/terminal?mode={mode}" turns={mode === 'claude'} autofocus onstate={(v) => (conn = v)} onscreen={(lines) => (question = mode === 'claude' ? findQuestion(lines) : null)} />
					{/key}
					<!-- The agent's state as a glow around its terminal, over it but never in the way. -->
					<div class="pointer-events-none absolute inset-0 z-10 {glowClass(view, { inset: true, connected: conn !== 'closed' })}"></div>
					{#if mode === 'claude' && conn === 'open'}
						<!-- Back through the conversation a turn at a time. Pressing keeps the terminal focused. -->
						<div class="absolute top-1/2 right-3 z-20 flex -translate-y-1/2 flex-col gap-1 opacity-40 transition-opacity hover:opacity-100 focus-within:opacity-100 max-sm:hidden">
							{#each [{ to: 'previous', title: 'Previous prompt (Ctrl+Shift+↑)', icon: ChevronUp }, { to: 'next', title: 'Next prompt (Ctrl+Shift+↓)', icon: ChevronDown }, { to: 'latest', title: 'Back to now', icon: ArrowDownToLine }] as const as j (j.to)}
								<button type="button" class="flex size-7 items-center justify-center rounded-md border border-term-edge text-[#c9cfda] hover:bg-white/10 hover:text-white" style="background: var(--term-chrome)" title={j.title} aria-label={j.title} onpointerdown={(e) => e.preventDefault()} onclick={() => term?.jumpTo(j.to)}><j.icon class="size-4" /></button>
							{/each}
						</div>
					{/if}
				</div>
				{#if touch}
					<!-- Keys a touch keyboard lacks. Pressing one keeps the terminal focused, so the keyboard stays up. -->
					<div class="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-term-edge px-2 py-1.5" style="background: var(--term-chrome)">
						<button type="button" class="btn btn-ghost btn-icon btn-sm shrink-0 text-[#aab2c0] hover:bg-white/5 hover:text-white" title="Show the keyboard" onpointerdown={(e) => e.preventDefault()} onclick={() => term?.focus()}><Keyboard /></button>
						{#each KEYS as k (k.label)}
							<button type="button" class="h-8 min-w-9 shrink-0 rounded-md border border-term-edge px-2 font-mono text-xs text-[#d5d9e2] hover:bg-white/5 disabled:opacity-40" title={k.title} disabled={conn !== 'open'} onpointerdown={(e) => e.preventDefault()} onclick={() => term?.input(k.seq)}>
								{#if k.label === '↑'}<ArrowUp class="mx-auto size-3.5" />{:else if k.label === '↓'}<ArrowDown class="mx-auto size-3.5" />{:else if k.label === '⏎'}<CornerDownLeft class="mx-auto size-3.5" />{:else}{k.label}{/if}
							</button>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6" style="background: var(--term-bg)">
					{#if live?.tail?.length}
						<pre class="pointer-events-none absolute inset-x-0 top-0 max-h-full overflow-hidden px-4 py-3 font-mono text-[0.6875rem] leading-[1.15rem] text-[#c9cfda] opacity-25 select-none">{live.tail.join('\n')}</pre>
					{/if}
					<div class="relative w-full max-w-md rounded-2xl p-6 text-[#e6e8ee] {glowClass(view)}" style="background: var(--term-chrome)">
						{#if s.status === 'starting'}
							<p class="flex items-center gap-2.5 font-medium"><LoaderCircle class="size-4 animate-spin text-primary" />Starting…</p>
							<p class="mt-1.5 text-[0.8125rem] text-[#9aa3b2]">Creating the container. The first start also pulls the session image, which can take a minute.</p>
						{:else}
							{#if s.status === 'error'}
								<p class="flex items-center gap-2 font-medium text-danger"><CircleAlert class="size-4" />The session failed to start</p>
								{#if s.error}<pre class="mt-2 max-h-40 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[0.6875rem] whitespace-pre-wrap text-[#f2b8ba]">{s.error}</pre>{/if}
							{:else}
								<p class="font-medium">Session stopped</p>
								<p class="mt-1 text-[0.8125rem] text-[#9aa3b2]">The repo, its changes and every conversation are kept. Start it to get the terminal back.</p>
							{/if}
							<div class="mt-4 flex flex-wrap gap-2">
								<button class="btn btn-primary" disabled={busy} onclick={() => launch({ mode: 'continue' })}>
									{#if busy}<LoaderCircle class="animate-spin" />{:else}<Play />{/if}{sum ? 'Resume newest conversation' : 'Start'}
								</button>
								{#if sum}<button class="btn btn-secondary" disabled={busy} onclick={() => launch({ mode: 'new' })}><FilePlus2 />New conversation</button>{/if}
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Details -->
		{#if panel}
			<aside class="w-80 shrink-0 overflow-y-auto border-l border-border bg-surface max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:shadow-surface-lg">
				{#if isClaude}
				<PanelSection id="summary" title="Summary">
					{#snippet action()}
						<button class="btn btn-ghost btn-sm -mr-2" disabled={!running || summarizing || !sum} title="Ask a small model for a summary (uses the session's Claude account)" onclick={summarize}>
							{#if summarizing}<LoaderCircle class="animate-spin" />{:else}<Sparkles />{/if}Summarize
						</button>
					{/snippet}
					<div class="space-y-2">
					{#if live?.aiSummary}
						<p class="text-[0.8125rem] leading-relaxed">{live.aiSummary.text}</p>
						<p class="text-[0.6875rem] text-muted-foreground">{ago(live.aiSummary.at)}</p>
					{/if}
					{#if sum}
						{#if sum.title && sum.title !== s.name}<p class="text-[0.8125rem] font-medium">{sum.title}</p>{/if}
						{#if sum.lastPrompt}<p class="line-clamp-4 text-xs text-muted-foreground"><span class="font-medium text-foreground/80">You:</span> {sum.lastPrompt}</p>{/if}
						{#if sum.lastReply}<p class="line-clamp-6 text-xs text-muted-foreground"><span class="font-medium text-primary">Claude:</span> {sum.lastReply}</p>{/if}
						{#if sum.lastTool}<p class="truncate font-mono text-[0.6875rem] text-muted-foreground" title={sum.lastTool}>{sum.lastTool}</p>{/if}
						<p class="text-[0.6875rem] text-muted-foreground">{sum.messages} messages · {ago(sum.updatedAt)}</p>
					{:else}
						<p class="text-xs text-muted-foreground">Nothing yet. Once you talk to Claude, the latest exchange shows here.</p>
					{/if}
					</div>
				</PanelSection>
				{:else}
				<section class="space-y-1.5 border-b border-border p-4">
					<h2 class="text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/80 uppercase">{AGENT_LABEL[s.agent]}</h2>
					<p class="text-xs text-muted-foreground">
						{#if live?.tail?.length}Live status comes from the terminal.{/if}
						Summaries and the conversation list are for Claude Code sessions. {AGENT_LABEL[s.agent]} keeps its own history: Session → Continue newest conversation picks it up again.
					</p>
				</section>
				{/if}

				{#if sum?.todos.length}
					<PanelSection id="tasks" title="Tasks" icon={ListTodo}>
						<ul class="space-y-1.5">
							{#each sum.todos as t, i (i)}
								<li class="flex items-start gap-2 text-xs">
									<span class="mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border {t.status === 'completed' ? 'border-success bg-success/20' : t.status === 'in_progress' ? 'border-primary' : 'border-border'}">
										{#if t.status === 'in_progress'}<span class="size-1.5 animate-pulse rounded-full bg-primary"></span>{/if}
									</span>
									<span class={t.status === 'completed' ? 'text-muted-foreground line-through' : t.status === 'in_progress' ? 'font-medium' : ''}>{t.content}</span>
								</li>
							{/each}
						</ul>
					</PanelSection>
				{/if}

				{#if git}
					<PanelSection id="git" title="Git" icon={GitBranch}>
						<div class="text-xs">
						<p class="font-mono">{git.branch ?? 'detached HEAD'}</p>
						<p class="mt-1 text-muted-foreground">
							{git.changed} changed file{git.changed === 1 ? '' : 's'} ·
							<span class="text-success">+{git.insertions}</span> <span class="text-danger">−{git.deletions}</span>
							{#if git.ahead} · {git.ahead} unpushed{/if}{#if git.behind} · {git.behind} behind{/if}
						</p>
						</div>
					</PanelSection>
				{/if}

				{#if isClaude}
					<PanelSection id="conversations" title="Conversations" icon={History}>
						<Conversations sessionId={s.id} sessionName={s.name} initial={data.conversations} current={sum?.conversationId} updated={sum?.updatedAt} onresume={resume} />
					</PanelSection>
				{/if}

				<PanelSection id="settings" title="Session">
					<div class="space-y-3 text-[0.8125rem]">
					<div>
						<label class="label" for="acct">{AGENT_LABEL[s.agent]} account</label>
						<select id="acct" class="input h-8 text-xs" value={s.accountId} onchange={(e) => patch({ accountId: e.currentTarget.value })}>
							{#each sameAgentAccounts as a (a.id)}<option value={a.id}>{a.name} · {ACCOUNT_KINDS[a.kind].label}</option>{/each}
						</select>
					</div>
					<div>
						<label class="label flex items-center gap-1.5" for="gh"><BrandIcon brand="github" class="size-3.5" />GitHub account</label>
						<select id="gh" class="input h-8 text-xs" value={s.githubAccountId ?? ''} onchange={(e) => patch({ githubAccountId: e.currentTarget.value || null })}>
							{#each data.githubAccounts as a (a.id)}<option value={a.id}>{githubLabel(a)}</option>{/each}
							<option value="">None</option>
						</select>
					</div>
					{#if data.awsProfiles.length || s.awsProfileIds.length}
						<div>
							<span class="label flex items-center gap-1.5"><BrandIcon brand="bedrock" class="size-3.5" />AWS</span>
							<AwsProfilePicker profiles={data.awsProfiles} value={s.awsProfileIds} status={live?.aws ?? null} onchange={setAws} />
							{#if account?.kind === 'bedrock' && s.awsProfileIds.length}<p class="mt-1.5 text-xs text-warning">Claude on Bedrock puts AWS_REGION (and its keys, if it uses keys) in the environment, which the AWS CLI prefers to profiles: use --profile with each name.</p>{/if}
						</div>
					{/if}
					<div class="grid grid-cols-2 gap-2">
						<div>
							<label class="label" for="model">Model</label>
							<ModelPicker id="model" class="h-8 text-xs" value={s.model ?? ''} agent={s.agent} kind={account?.kind} onchange={changeModel} />
						</div>
						<div>
							<label class="label" for="perm">Permissions</label>
							<select id="perm" class="input h-8 text-xs" value={s.permissionMode} onchange={(e) => patch({ permissionMode: e.currentTarget.value as Session['permissionMode'] })}>
								{#each permissionModes as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
							</select>
						</div>
					</div>
					<div class="flex items-center justify-between gap-3">
						<span>
							<span class="block font-medium">Remote Control</span>
							<span class="block text-xs text-muted-foreground">{rcAvailable ? 'claude.ai/code and the Claude app' : isClaude ? 'Needs a Claude subscription login' : 'Claude Code only'}</span>
						</span>
						<Switch checked={rcAvailable && s.remoteControl} disabled={!rcAvailable} label="Remote Control" onchange={(v) => patch({ remoteControl: v })} />
					</div>
					<p class="text-xs text-muted-foreground">Changes apply the next time {agentName} starts (Session → Continue newest conversation).</p>
					<div class="space-y-1.5 rounded-lg border border-border bg-background p-2.5">
						<p class="flex items-center justify-between text-xs">
							<span class="text-muted-foreground">Container</span>
							<span class="font-mono text-[0.6875rem]">{s.containerName}</span>
						</p>
						<button class="flex w-full items-center gap-1.5 text-left font-mono text-[0.6875rem] text-muted-foreground hover:text-foreground" title="Copy: attach to this session from a shell on the Docker host" onclick={() => copyText(attachCommand, 'Copied the attach command')}>
							<Copy class="size-3 shrink-0" /><span class="truncate">{attachCommand}</span>
						</button>
						<button class="flex items-center gap-1.5 font-mono text-[0.6875rem] text-muted-foreground hover:text-foreground" title="Copy the container's working directory" onclick={() => copyText(sessionWorkdir(s))}>
							<Copy class="size-3" />{sessionWorkdir(s)}
						</button>
					</div>
					</div>
				</PanelSection>
			</aside>
		{/if}
	</div>
</div>

<Dialog bind:open={modelSheet} title="Model" description="{agentName} restarts on the newest conversation with it." width="max-w-sm">
	<div class="space-y-1.5">
		{#each [{ value: '', label: 'Default model', hint: "Claude Code's choice" }, ...CLAUDE_ALIASES] as m (m.value)}
			<button
				type="button"
				class="flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-[0.8125rem] {(s.model ?? '') === m.value ? 'border-primary/60 bg-primary-soft' : 'border-border hover:bg-accent/40'}"
				onclick={() => ((modelSheet = false), changeModel(m.value))}
			>
				<span class="flex-1 font-medium">{m.label}</span><span class="text-xs text-muted-foreground">{m.hint}</span>
			</button>
		{/each}
	</div>
</Dialog>

<Dialog bind:open={skillOpen} title="Run a skill" description="Types the command into Claude's prompt in this session." width="max-w-lg">
	<form id="run-skill" class="space-y-3" onsubmit={runSkill}>
		<div class="grid gap-1.5">
			{#each skills as o (o.command)}
				<button
					type="button"
					class="flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left {skillCommand === o.command ? 'border-primary/60 bg-primary-soft' : 'border-border hover:bg-accent/40'}"
					onclick={() => (skillCommand = o.command)}
				>
					<span class="font-mono text-[0.8125rem] font-medium">{o.command}</span>
					<span class="min-w-0 truncate text-xs text-muted-foreground">{o.description}</span>
				</button>
			{/each}
		</div>
		<div class="grid grid-cols-[10rem_1fr] gap-2">
			<input class="input font-mono text-[0.8125rem]" bind:value={skillCommand} aria-label="Command" spellcheck="false" />
			<input class="input font-mono text-[0.8125rem]" bind:value={skillArgs} aria-label="Arguments" placeholder="Arguments, e.g. a PR number" />
		</div>
	</form>
	{#snippet footer()}
		<button class="btn btn-ghost" onclick={() => (skillOpen = false)}>Cancel</button>
		<button class="btn btn-primary" form="run-skill"><Wand />Run</button>
	{/snippet}
</Dialog>
