<script lang="ts">
	import { onMount } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import { LoaderCircle, Unplug } from '@lucide/svelte';
	import { copyText, writeClipboard } from '#lib/client/clipboard.ts';
	import { toast } from '#lib/client/state.svelte.ts';

	let {
		path,
		autofocus = false,
		onstate,
		onscreen,
		turns = false
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
	} = $props();

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
	let jump: (to: 'previous' | 'next' | 'latest') => void = () => {};

	/** Types into the terminal as if from the keyboard. */
	export function input(data: string) {
		forget();
		send(data);
	}

	export function focus() {
		focusTerm();
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

<div class="relative h-full min-h-0 w-full overflow-hidden bg-term" style="background: var(--term-bg)">
	<!-- Padding sits outside the host: the fit addon sizes rows from the host's own box. -->
	<!-- Dimmed while keystrokes can't reach the container. -->
	<div class="absolute inset-0 py-1.5 pl-2 transition-opacity duration-300 {conn === 'closed' ? 'opacity-45' : ''}">
		<div bind:this={host} class="h-full w-full"></div>
	</div>
	{#if inputLog}
		<button
			type="button"
			class="absolute top-2 right-2 z-20 rounded-full border border-term-edge bg-term-chrome/90 px-3 py-1 text-xs text-[#c9cfda]"
			onpointerdown={(e) => e.preventDefault()}
			onclick={() => copyText(inputLog!.join('\n'), 'Input log copied')}>Copy input log · {inputLog.length}</button
		>
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
