<script lang="ts">
	import { onMount } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import { LoaderCircle, Paperclip, Unplug } from '@lucide/svelte';
	import { copyText, writeClipboard } from '#lib/client/clipboard.ts';
	import { toast } from '#lib/client/state.svelte.ts';
	import { findHighlights, isChrome, type HighlightKind } from '#lib/highlight.ts';

	let {
		path,
		autofocus = false,
		onstate,
		onscreen,
		onfiles,
		turns = false,
		highlight = false
	}: {
		/** The WebSocket path, e.g. /ws/sessions/<id>/terminal?mode=claude. */
		path: string;
		/** Take the keyboard once connected (not on touch screens, where it would pop the keyboard up). */
		autofocus?: boolean;
		onstate?: (state: 'connecting' | 'open' | 'closed') => void;
		/** The visible lines as text, shortly after the screen changes. */
		onscreen?: (lines: string[]) => void;
		/** Whether the terminal is the agent's tmux, where jumpTo moves between turns. */
		turns?: boolean;
		/** Files pasted or dropped onto the terminal; without it, they're left to the browser. */
		onfiles?: (files: File[]) => void;
		/** Colour bold text, questions, urgent things and things for you to do on the agent's screen. */
		highlight?: boolean;
	} = $props();

	// Highlights lie over the rows they colour: tmux draws in the alternate screen, where xterm's
	// own decorations don't work, and the stream itself is left as tmux sent it. Multiplying
	// tints light text and leaves the dark background dark.
	type MarkKind = HighlightKind | 'bold';
	const MARK: Record<MarkKind, string> = { bold: '#9ec1ff', question: '#ffd88a', urgent: '#ff9396', action: '#8de6f0' };
	let layer: HTMLDivElement;
	let marks = $state<{ kind: MarkKind; top: number; height: number; left: number; width: number }[]>([]);

	// Files pasted (a screenshot on the clipboard) or dropped: taken before xterm, which only
	// knows text. A plain text paste still goes to xterm.
	let dropping = $state(false);
	const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
	function onpaste(e: ClipboardEvent) {
		const files = [...(e.clipboardData?.files ?? [])];
		if (!onfiles || !files.length) return;
		e.preventDefault();
		e.stopPropagation();
		onfiles(files);
	}
	function ondragover(e: DragEvent) {
		if (!onfiles || !hasFiles(e)) return;
		e.preventDefault();
		dropping = true;
	}
	function ondrop(e: DragEvent) {
		dropping = false;
		const files = [...(e.dataTransfer?.files ?? [])];
		if (!onfiles || !files.length) return;
		e.preventDefault();
		onfiles(files);
	}

	let host: HTMLDivElement;
	let conn = $state<'connecting' | 'open' | 'closed'>('connecting');
	let reason = $state('');

	// ?debug=input on the page records what the keyboard does and what is sent, to copy into a
	// bug report: phone keyboards behave differently from desktop ones and from emulators.
	let inputLog = $state<string[] | null>(null);
	const note = (line: string) => {
		if (!inputLog) return;
		inputLog.push(`${(performance.now() / 1000).toFixed(3)} ${line}`);
		if (inputLog.length > 400) inputLog.shift();
	};

	// The terminal stays dark in both themes; colours tuned for Claude Code's dark theme.
	const PALETTE = {
		foreground: '#e6e8ee',
		cursor: '#9ec1ff',
		cursorAccent: '#0d1117',
		selectionBackground: '#3b5b9a80',
		black: '#1b1f27',
		red: '#f2777a',
		green: '#8fd18b',
		yellow: '#f2c46d',
		blue: '#7aa8ff',
		magenta: '#c49cf2',
		cyan: '#6fd3e0',
		white: '#d5d9e2',
		brightBlack: '#5c6370',
		brightRed: '#ff9396',
		brightGreen: '#a8e6a3',
		brightYellow: '#ffd88a',
		brightBlue: '#9ec1ff',
		brightMagenta: '#d9b8ff',
		brightCyan: '#8de6f0',
		brightWhite: '#ffffff'
	};

	let ws: WebSocket | null = null;
	let send: (data: string) => void = () => {};
	let forget = () => {};
	let focusTerm: () => void = () => {};
	let pasteText: (text: string) => void = () => {};
	let jump: (to: 'previous' | 'next' | 'latest') => void = () => {};

	/** Types into the terminal as if from the keyboard. */
	export function input(data: string) {
		forget();
		send(data);
	}

	export function focus() {
		focusTerm();
	}

	/** Pastes text as the clipboard would (bracketed, when the program asks for that). */
	export function paste(text: string) {
		forget();
		pasteText(text);
	}

	/** Scrolls tmux's history to the previous or next prompt you sent, or back to now. */
	export function jumpTo(to: 'previous' | 'next' | 'latest') {
		if (turns) jump(to);
	}

	/** Whether keystrokes reach the container right now. */
	export function isOpen() {
		return ws?.readyState === WebSocket.OPEN;
	}

	function setConn(s: typeof conn) {
		conn = s;
		onstate?.(s);
	}

	onMount(() => {
		let disposed = false;
		let retry = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let cleanup = () => {};

		void (async () => {
			const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { Unicode11Addon }] = await Promise.all([
				import('@xterm/xterm'),
				import('@xterm/addon-fit'),
				import('@xterm/addon-web-links'),
				import('@xterm/addon-unicode11')
			]);
			if (disposed) return;
			const bg = getComputedStyle(host).getPropertyValue('--term-bg').trim() || '#0d1117';
			const term = new Terminal({
				fontFamily: "'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace",
				fontSize: matchMedia('(pointer: coarse)').matches ? 12 : 13,
				lineHeight: 1,
				cursorBlink: true,
				allowProposedApi: true,
				// Hyperlinks a program prints (OSC 8) open in a new tab, like the plain-text ones.
				linkHandler: { activate: (_e, uri) => window.open(uri, '_blank', 'noopener') },
				macOptionIsMeta: true,
				scrollback: 2000,
				theme: { ...PALETTE, background: bg }
			});
			const fit = new FitAddon();
			term.loadAddon(fit);
			term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank', 'noopener')));
			term.loadAddon(new Unicode11Addon());
			term.unicode.activeVersion = '11';
			term.open(host);
			// Fonts load after first paint; measure cells only once they're in.
			await document.fonts?.ready;
			fit.fit();
			focusTerm = () => term.focus();
			pasteText = (text) => term.paste(text);

			// Copy from tmux / Claude Code arrives as OSC 52, a moment after the mouse is released.
			// Browsers often refuse the clipboard by then, so the text is kept for a right-click,
			// which they allow.
			let selected = '';
			term.parser.registerOscHandler(52, (data) => {
				const b64 = data.split(';').pop() ?? '';
				try {
					const text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
					if (!text) return true;
					selected = text;
					void writeClipboard(text).then((ok) =>
						ok ? toast('success', 'Copied from the terminal') : toast('info', 'Selected', 'Right-click the terminal to copy it')
					);
				} catch {}
				return true;
			});
			// A Shift-selection is the browser's own, and its menu copies it.
			const onContextMenu = (e: MouseEvent) => {
				if (term.hasSelection() || !selected) return;
				e.preventDefault();
				e.stopPropagation();
				void copyText(selected, 'Copied from the terminal');
			};
			host.addEventListener('contextmenu', onContextMenu, true);

			if (new URLSearchParams(location.search).get('debug') === 'input' && term.textarea) {
				inputLog = [`${navigator.userAgent} · ${term.cols}x${term.rows}`];
				const ta = term.textarea;
				// On the host, capturing: Android input is taken over there before it reaches the textarea.
				const show = (v: string | null | undefined) => JSON.stringify(v ?? null);
				for (const type of ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'focus', 'blur'] as const) {
					host.addEventListener(type, (e) => {
						if (e.target !== ta) return;
						const extra =
							e instanceof KeyboardEvent ? `key=${show(e.key)} code=${e.keyCode}` : e instanceof InputEvent ? `${e.inputType} data=${show(e.data)}` : e instanceof CompositionEvent ? `data=${show(e.data)}` : '';
						note(`${type} ${extra} value=${show(ta.value)}`);
					}, true);
				}
				term.onResize(({ cols, rows }) => note(`resize ${cols}x${rows}`));
			}

			const raw = (data: string) => {
				note(`sent ${JSON.stringify(data)}`);
				if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'i', d: data }));
			};

			// Scrolling, one line per row of wheel or finger travel. Under tmux (which asks for the
			// mouse) the history isn't in xterm: the wheel becomes wheel reports, one per line, for
			// tmux's history view (bindings in upgrade.ts) or for the program in it (Claude Code
			// scrolls its own transcript a line per report). A plain shell scrolls xterm's buffer.
			const tmux = () => term.modes.mouseTrackingMode !== 'none';
			const cellHeight = () => host.clientHeight / term.rows || 16;
			let inHistory = false;
			let rest = 0;
			const scrollBy = (px: number) => {
				rest += px;
				const lines = Math.trunc(rest / cellHeight());
				if (!lines) return;
				rest -= lines * cellHeight();
				if (tmux()) {
					if (lines < 0) inHistory = true;
					raw(`\x1b[<${lines < 0 ? 64 : 65};1;1M`.repeat(Math.min(Math.abs(lines), 200)));
				} else term.scrollLines(lines);
			};
			term.attachCustomWheelEventHandler((e) => {
				// Without tmux, xterm's own scrolling (or its arrow keys for full-screen programs).
				if (!tmux()) return true;
				scrollBy(e.deltaMode === 1 ? e.deltaY * cellHeight() : e.deltaMode === 2 ? e.deltaY * host.clientHeight : e.deltaY);
				e.preventDefault();
				return false;
			});

			// One finger drags the history, and a flick keeps it going for a moment.
			let touchY: number | null = null;
			let touchAt = 0;
			let speed = 0;
			let glide = 0;
			const onTouchStart = (e: TouchEvent) => {
				cancelAnimationFrame(glide);
				clearTimeout(screenTimer);
				touchY = e.touches.length === 1 ? e.touches[0].clientY : null;
				touchAt = e.timeStamp;
				speed = 0;
			};
			const onTouchMove = (e: TouchEvent) => {
				if (touchY === null || e.touches.length !== 1) return;
				const y = e.touches[0].clientY;
				const dy = touchY - y;
				touchY = y;
				speed = dy / Math.max(1, e.timeStamp - touchAt);
				touchAt = e.timeStamp;
				scrollBy(dy);
				e.preventDefault();
				e.stopPropagation();
			};
			const onTouchEnd = () => {
				if (touchY === null) return;
				touchY = null;
				let v = speed * 16;
				const step = () => {
					v *= 0.95;
					if (Math.abs(v) < 0.5) return;
					scrollBy(v);
					glide = requestAnimationFrame(step);
				};
				step();
			};
			host.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
			host.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
			host.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
			host.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });

			// Keys typed while scrolled back go to the agent, not to tmux's history view: leave
			// it first (Meta+wheel-down, bound to cancel). Mouse reports (clicks) don't count.
			send = (data: string) => {
				if (inHistory && !data.startsWith('\x1b[<') && !data.startsWith('\x1b[M')) {
					inHistory = false;
					rest = 0;
					raw('\x1b[<73;1;1M');
				}
				raw(data);
			};
			term.onData((d) => send(d));
			term.onBinary((d) => send(d));

			// Keys tmux knows as User0 and User1, bound to the jumps (upgrade.ts).
			jump = (to) => {
				if (to === 'latest') {
					inHistory = false;
					rest = 0;
					raw('\x1b[<73;1;1M');
				} else {
					if (to === 'previous') inHistory = true;
					raw(to === 'previous' ? '\x1b[9900~' : '\x1b[9901~');
				}
				focusTerm();
			};
			// Ctrl+Shift+Up and Down (or with Cmd) jump between turns.
			term.attachCustomKeyEventHandler((e) => {
				// Windows and Linux: Ctrl+V (and Ctrl+Shift+V) paste, as everywhere else, instead of
				// going to the program as ^V. Left to the browser, it fires a paste: text goes to the
				// terminal, files to onfiles. (On a Mac it's ⌘V, which xterm leaves alone already.)
				if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'v') return false;
				// Ctrl+C with text selected in xterm (a Shift-drag) copies it; without, it interrupts.
				if (e.type === 'keydown' && e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
					e.preventDefault();
					void copyText(term.getSelection(), 'Copied from the terminal');
					term.clearSelection();
					return false;
				}
				if (!turns || e.type !== 'keydown' || !e.shiftKey || !(e.ctrlKey || e.metaKey) || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return true;
				e.preventDefault();
				jump(e.key === 'ArrowUp' ? 'previous' : 'next');
				return false;
			});

			// Android keyboards report every key as 229 and edit xterm's hidden textarea directly:
			// composing words, autocorrecting, and re-editing earlier words, e.g. after the layout
			// changes. xterm diffs that textarea, and when an earlier part changes it resends the
			// whole of it: text typed so far appears twice. So on Android the difference is sent
			// here: backspaces for what the keyboard removed, then what it added. Keys xterm handles
			// itself (Enter, arrows, a hardware keyboard) still go to xterm.
			let offAndroid = () => {};
			if (/Android/i.test(navigator.userAgent) && term.textarea) {
				const ta = term.textarea;
				let synced = '';
				let hardKey = false;
				const sync = () => {
					const now = ta.value;
					let same = 0;
					while (same < synced.length && same < now.length && synced[same] === now[same]) same++;
					const out = '\x7f'.repeat(synced.length - same) + now.slice(same);
					synced = now;
					if (out) send(out);
				};
				// The terminal's line moved on without the textarea (Enter, arrows, a key bar button).
				forget = () => {
					ta.value = '';
					synced = '';
				};
				const keydown = (e: KeyboardEvent) => {
					if (e.target !== ta) return;
					if (e.keyCode === 229) return e.stopPropagation();
					hardKey = true;
					setTimeout(() => (hardKey = false));
					if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) setTimeout(forget);
				};
				const composition = (e: Event) => {
					if (e.target === ta) e.stopPropagation();
				};
				const input = (e: Event) => {
					if (e.target !== ta) return;
					// A hardware key's character: xterm sends it.
					if (hardKey && (e as InputEvent).inputType === 'insertText') {
						synced = ta.value;
						return;
					}
					e.stopPropagation();
					sync();
				};
				const blur = () => (synced = ''); // xterm empties the textarea on blur
				const types = ['compositionstart', 'compositionupdate', 'compositionend'];
				host.addEventListener('keydown', keydown, true);
				host.addEventListener('input', input, true);
				for (const t of types) host.addEventListener(t, composition, true);
				ta.addEventListener('blur', blur);
				offAndroid = () => {
					host.removeEventListener('keydown', keydown, true);
					host.removeEventListener('input', input, true);
					for (const t of types) host.removeEventListener(t, composition, true);
					ta.removeEventListener('blur', blur);
				};
			}

			const sendSize = () => {
				if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'r', c: term.cols, r: term.rows }));
			};
			const ro = new ResizeObserver(() => {
				if (!host.offsetWidth || !host.offsetHeight) return;
				fit.fit();
				sendSize();
			});
			ro.observe(host);

			// Runs of bold text (headings, and labels like "Security:"), which the text alone doesn't show.
			const cell = term.buffer.active.getNullCell();
			const boldRuns = (y: number): [number, number][] => {
				const line = term.buffer.active.getLine(y);
				if (!line) return [];
				const runs: [number, number][] = [];
				const add = (x0: number, x1: number) => {
					const text = line.translateToString(false, x0, x1);
					// Without the spaces at its ends, and only if it has a letter or digit.
					const lead = text.length - text.trimStart().length;
					const trail = text.length - text.trimEnd().length;
					if (/[\p{L}\p{N}]/u.test(text)) runs.push([x0 + lead, x1 - trail]);
				};
				let start = -1;
				for (let x = 0; x < line.length; x++) {
					const bold = !!line.getCell(x, cell)?.isBold();
					if (bold && start < 0) start = x;
					else if (!bold && start >= 0) {
						add(start, x);
						start = -1;
					}
				}
				if (start >= 0) add(start, line.length);
				return runs;
			};
			// Worked out as the terminal draws, in the same frame, so the colours move with the text
			// when it scrolls rather than catching up after it.
			const remark = () => {
				const screen = host.querySelector<HTMLElement>('.xterm-screen');
				if (!screen) return;
				const b = term.buffer.active;
				const lines: string[] = [];
				for (let y = b.viewportY; y < b.viewportY + term.rows; y++) lines.push(b.getLine(y)?.translateToString(true) ?? '');
				const at = screen.getBoundingClientRect();
				const origin = layer.getBoundingClientRect();
				const row = at.height / term.rows;
				const col = at.width / term.cols;
				const top = at.top - origin.top;
				const left = at.left - origin.left;
				const found = findHighlights(lines);
				const next: typeof marks = found.map((h) => ({ kind: h.kind, top: top + h.from * row, height: (h.to - h.from + 1) * row, left, width: at.width }));
				// Bold text outside those rows (inside them it's already coloured).
				lines.forEach((line, i) => {
					if (!line.trim() || isChrome(line) || found.some((h) => i >= h.from && i <= h.to)) return;
					for (const [x0, x1] of boldRuns(b.viewportY + i)) next.push({ kind: 'bold', top: top + i * row, height: row, left: left + x0 * col, width: (x1 - x0) * col });
				});
				marks = next;
			};
			if (highlight) term.onRender(remark);

			let screenTimer: ReturnType<typeof setTimeout> | undefined;
			const screenChanged = () => {
				if (!onscreen || screenTimer) return;
				screenTimer = setTimeout(() => {
					screenTimer = undefined;
					const b = term.buffer.active;
					const lines: string[] = [];
					for (let y = b.viewportY; y < b.viewportY + term.rows; y++) lines.push(b.getLine(y)?.translateToString(true) ?? '');
					onscreen(lines);
				}, 150);
			};

			const lost = (sock: WebSocket, why: string) => {
				if (ws !== sock) return;
				ws = null;
				if (sock.readyState !== WebSocket.CLOSED) sock.close();
				reason = why;
				setConn('closed');
				if (disposed) return;
				// Back off up to 10 s; the session may be restarting.
				timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
			};

			const connect = () => {
				if (disposed) return;
				setConn('connecting');
				const proto = location.protocol === 'https:' ? 'wss' : 'ws';
				const sep = path.includes('?') ? '&' : '?';
				const sock = new WebSocket(`${proto}://${location.host}${path}${sep}cols=${term.cols}&rows=${term.rows}`);
				sock.binaryType = 'arraybuffer';
				ws = sock;
				sock.onopen = () => {
					retry = 0;
					reason = '';
					setConn('open');
					sendSize();
					// Unless the user is typing in a field elsewhere on the page.
					const el = document.activeElement;
					const typing = el instanceof HTMLElement && !el.closest('.xterm') && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
					if (autofocus && !typing && !matchMedia('(pointer: coarse)').matches) term.focus();
				};
				// A network that drops without a word (a phone changing networks, a laptop
				// waking) never fires close: ping, and give up on a line that stays silent.
				let heard = Date.now();
				const heartbeat = setInterval(() => {
					if (sock.readyState !== WebSocket.OPEN) return;
					if (Date.now() - heard > 25_000) lost(sock, '');
					else sock.send(JSON.stringify({ t: 'p' }));
				}, 10_000);
				sock.onmessage = (e) => {
					heard = Date.now();
					if (typeof e.data === 'string') term.write(e.data, screenChanged);
					else if (e.data.byteLength) term.write(new Uint8Array(e.data as ArrayBuffer), screenChanged);
				};
				sock.onclose = (e) => {
					clearInterval(heartbeat);
					lost(sock, e.reason && e.reason !== 'ended' ? e.reason : '');
				};
			};
			connect();

			// Phones drop the connection while the tab is in the background (e.g. on a sign-in
			// page): reconnect the moment it's back, instead of waiting out the backoff.
			const wake = () => {
				if (document.visibilityState !== 'visible' || ws || disposed) return;
				clearTimeout(timer);
				retry = 0;
				connect();
			};
			document.addEventListener('visibilitychange', wake);
			window.addEventListener('online', wake);
			window.addEventListener('pageshow', wake);

			cleanup = () => {
				document.removeEventListener('visibilitychange', wake);
				window.removeEventListener('online', wake);
				window.removeEventListener('pageshow', wake);
				cancelAnimationFrame(glide);
				host.removeEventListener('touchstart', onTouchStart, true);
				host.removeEventListener('touchmove', onTouchMove, true);
				host.removeEventListener('touchend', onTouchEnd, true);
				host.removeEventListener('touchcancel', onTouchEnd, true);
				host.removeEventListener('contextmenu', onContextMenu, true);
				ro.disconnect();
				offAndroid();
				ws?.close();
				term.dispose();
			};
		})();

		return () => {
			disposed = true;
			clearTimeout(timer);
			cleanup();
		};
	});
</script>

<div
	class="relative h-full min-h-0 w-full overflow-hidden bg-term"
	style="background: var(--term-bg)"
	role="presentation"
	onpastecapture={onpaste}
	{ondragover}
	ondragleave={(e) => !(e.currentTarget as Node).contains(e.relatedTarget as Node) && (dropping = false)}
	{ondrop}
>
	<!-- Padding sits outside the host: the fit addon sizes rows from the host's own box. -->
	<!-- Dimmed while keystrokes can't reach the container. -->
	<div bind:this={layer} class="absolute inset-0 isolate py-1.5 pl-2 transition-opacity duration-300 {conn === 'closed' ? 'opacity-45' : ''}">
		<div bind:this={host} class="h-full w-full"></div>
		{#each marks as m, i (i)}
			<div class="pointer-events-none absolute mix-blend-multiply" style="top: {m.top}px; height: {m.height}px; left: {m.left}px; width: {m.width}px; background: {MARK[m.kind]}"></div>
			{#if m.kind !== 'bold'}
				<!-- A bar in the margin, to find them when scanning down. -->
				<div class="pointer-events-none absolute w-0.5 rounded-full" style="top: {m.top + 1}px; height: {m.height - 2}px; left: {m.left - 6}px; background: {MARK[m.kind]}"></div>
			{/if}
		{/each}
	</div>
	{#if inputLog}
		<button
			type="button"
			class="absolute top-2 right-2 z-20 rounded-full border border-term-edge bg-term-chrome/90 px-3 py-1 text-xs text-[#c9cfda]"
			onpointerdown={(e) => e.preventDefault()}
			onclick={() => copyText(inputLog!.join('\n'), 'Input log copied')}>Copy input log · {inputLog.length}</button
		>
	{/if}
	{#if dropping}
		<div class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/70 bg-black/50 text-sm text-[#e6e8ee]">
			<span class="flex items-center gap-2"><Paperclip class="size-4" />Drop to attach</span>
		</div>
	{/if}
	{#if conn !== 'open'}
		<div class="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
			<span class="flex items-center gap-2 rounded-full border border-term-edge bg-term-chrome/90 px-3 py-1 text-xs text-[#c9cfda] shadow-surface-lg backdrop-blur">
				{#if conn === 'connecting'}
					<LoaderCircle class="size-3.5 animate-spin" />Connecting…
				{:else}
					<Unplug class="size-3.5" />{reason || 'Disconnected'} · retrying
				{/if}
			</span>
		</div>
	{/if}
</div>

<style>
	div :global(.xterm) {
		height: 100%;
	}
	div :global(.xterm-viewport) {
		scrollbar-width: thin;
		scrollbar-color: #3a4150 transparent;
	}
</style>
