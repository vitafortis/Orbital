/**
 * Terminal WebSockets. Each browser tab gets its own `docker exec` with a TTY: `tmux attach`
 * for the Claude pane (so Claude keeps running when the tab closes, and several tabs can
 * watch one session) or a plain login shell.
 *
 *   /ws/sessions/<id>/terminal?mode=claude|shell&cols=&rows=
 *   /ws/accounts/<id>/login?cols=&rows=
 *
 * Protocol: the server sends terminal output as binary frames. The browser sends JSON text
 * frames: {"t":"i","d":"…"} for input and {"t":"r","c":cols,"r":rows} to resize.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { authenticateToken, sessionTokenFromHeader } from '../auth.ts';
import { exec, execTty } from '../docker.ts';
import { loginContainer } from '../accounts.ts';
import { runningContainer, workdir } from '../sessions/runtime.ts';

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

const ENV = ['TERM=xterm-256color', 'COLORTERM=truecolor', 'LANG=C.UTF-8'];

function reject(socket: Duplex, status: number, message: string) {
	socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
}

/** Same check as hooks.server.ts: the page that opens the socket must be ours. */
function sameOrigin(req: IncomingMessage): boolean {
	const origin = req.headers.origin;
	if (!origin) return true;
	let host = '';
	try {
		host = new URL(origin).host;
	} catch {}
	const allowed = [req.headers.host, req.headers['x-forwarded-host']].flat().filter(Boolean);
	return allowed.includes(host);
}

const clamp = (v: string | null, lo: number, hi: number, d: number) => {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};

type Target = { container: string; cmd: string[]; workdir?: string; tmux?: boolean };

/**
 * Docker doesn't end an exec when its connection closes, so a viewer that went away (a tab
 * closed, a phone asleep) would leave its `tmux attach` running. Enough of those and the
 * tmux server runs out of file descriptors: new viewers get "open terminal failed: not a
 * terminal" and the live view can't read the pane. Our viewers' clients are marked with
 * VIEWER and announce their tty first; any marked client whose tty no open socket holds is
 * ended, when a viewer leaves and before one attaches. A `tmux attach` a person runs by
 * hand (the panel's command) isn't marked, so it's left alone.
 */
const VIEWER = 'ORB_VIEWER=1';
const RS = 0x1e;
const viewers = new Map<string, { ttys: Set<string>; opening: number; again: boolean }>();

// Clients from before the mark: Orbital's attach, with and without its wheel bindings.
const SWEEP = `for p in /proc/[0-9]*; do
	case "$(tr '\\0' ' ' < "$p/cmdline" 2>/dev/null)" in
		'tmux attach-session -t main ' | 'tmux bind -T copy-mode WheelUpPane '*' attach-session -t main ') ;;
		*) grep -qxz '${VIEWER}' "$p/environ" 2>/dev/null || continue ;;
	esac
	t=$(readlink "$p/fd/0" 2>/dev/null) || continue
	case " $* " in *" $t "*) ;; *) kill "\${p#/proc/}" 2>/dev/null ;; esac
done`;

function viewersOf(container: string) {
	let v = viewers.get(container);
	if (!v) viewers.set(container, (v = { ttys: new Set(), opening: 0, again: false }));
	return v;
}

/** Ends this container's viewer clients that no open socket holds. */
async function sweep(container: string) {
	const v = viewersOf(container);
	// A client that's starting hasn't told us its tty yet: sweep once it has.
	if (v.opening) {
		v.again = true;
		return;
	}
	await exec(container, ['bash', '-c', SWEEP, 'sweep', ...v.ttys], { user: 'node', timeoutMs: 10_000 }).catch(() => {});
}

// A prompt in Claude Code's history: "❯ text" (older versions "> text"). The input box has
// a no-break space after its ❯, so it doesn't match.
const PROMPT = `'^(❯|>) [^ ]'`;
const PREVIOUS = `send -X start-of-line ; send -X search-backward ${PROMPT} ; send -X scroll-top`;
const NEXT = `send -X cursor-down ; send -X search-forward ${PROMPT} ; send -X scroll-top`;

/**
 * Attaches to the agent's tmux, first binding the wheel in tmux's history view to one line
 * per report (the browser sends one per line it scrolls; tmux's default is five) and
 * Meta+wheel-down to leaving it, which the browser sends before keys typed while scrolled
 * back. Right-click does nothing in tmux, so the page can copy tmux's selection with it
 * (Terminal.svelte) without tmux's menu opening too. Set here rather than in tmux.conf so
 * sessions on an older image get them too.
 */
const ATTACH = [
	'tmux',
	...['copy-mode', 'copy-mode-vi'].flatMap((t) => [
		...['bind', '-T', t, 'WheelUpPane', 'send', '-X', '-N', '1', 'scroll-up', ';'],
		...['bind', '-T', t, 'WheelDownPane', 'send', '-X', '-N', '1', 'scroll-down', ';'],
		...['bind', '-T', t, 'M-WheelDownPane', 'send', '-X', 'cancel', ';']
	]),
	...['unbind', '-n', 'MouseDown3Pane', ';'],
	// Two keys of Orbital's own (Terminal.svelte jumpTo) move between the prompts you sent:
	// back from the screen into the history, then back or forward in it, each to the top.
	...['set', '-s', 'user-keys[0]', '\x1b[9900~', ';', 'set', '-s', 'user-keys[1]', '\x1b[9901~', ';', 'set', '-g', 'wrap-search', 'off', ';'],
	...['bind', '-n', 'User0', `copy-mode -e ; ${PREVIOUS}`, ';'],
	...['copy-mode', 'copy-mode-vi'].flatMap((t) => [...['bind', '-T', t, 'User0', PREVIOUS, ';'], ...['bind', '-T', t, 'User1', NEXT, ';']]),
	'attach-session',
	'-t',
	'main'
];

async function resolveTarget(path: string, params: URLSearchParams): Promise<Target> {
	let m = /^\/ws\/sessions\/([0-9a-f-]{36})\/terminal$/.exec(path);
	if (m) {
		const { session, container } = await runningContainer(m[1]);
		const shell = params.get('mode') === 'shell';
		return { container, workdir: workdir(session), cmd: shell ? ['bash', '-l'] : ATTACH, tmux: !shell };
	}
	m = /^\/ws\/accounts\/([0-9a-f-]{36})\/login$/.exec(path);
	if (m) {
		const container = await loginContainer(m[1]);
		if (!container) throw new Error('The sign-in container is not running');
		return { container, cmd: ATTACH, tmux: true };
	}
	throw new Error('Not found');
}

export async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
	const url = new URL(req.url ?? '/', 'http://localhost');
	if (!sameOrigin(req)) return reject(socket, 403, 'Cross-origin request blocked');
	const { state } = authenticateToken(sessionTokenFromHeader(req.headers.cookie));
	if (state !== 'authenticated' && state !== 'disabled') return reject(socket, 401, 'Not signed in');

	let target: Target;
	try {
		target = await resolveTarget(url.pathname, url.searchParams);
	} catch (err) {
		return reject(socket, 409, err instanceof Error ? err.message : 'Unavailable');
	}

	const cols = clamp(url.searchParams.get('cols'), 20, 500, 120);
	const rows = clamp(url.searchParams.get('rows'), 5, 200, 32);

	wss.handleUpgrade(req, socket, head, (ws) => void bridge(ws, target, cols, rows));
}

async function bridge(ws: WebSocket, target: Target, cols: number, rows: number) {
	const v = target.tmux ? viewersOf(target.container) : null;
	let tty: Awaited<ReturnType<typeof execTty>>;
	try {
		if (v) {
			await sweep(target.container);
			v.opening++;
		}
		// tmux: print the client's tty between two RS bytes, then become the client.
		const cmd = v ? ['bash', '-c', `printf '\\036%s\\036' "$(tty)"; exec "$@"`, 'attach', ...target.cmd] : target.cmd;
		tty = await execTty(target.container, cmd, { user: 'node', env: v ? [...ENV, VIEWER] : ENV, workdir: target.workdir, cols, rows });
	} catch (err) {
		if (v) v.opening--;
		ws.close(1011, (err instanceof Error ? err.message : 'exec failed').slice(0, 120));
		return;
	}
	const { stream, resize } = tty;
	void resize(cols, rows);

	let client: string | null = null;
	let head: Buffer | null = v ? Buffer.alloc(0) : null;
	const opened = () => {
		if (!v || head === null) return;
		head = null;
		v.opening--;
		if (client) v.ttys.add(client);
		if (!v.opening && v.again) {
			v.again = false;
			void sweep(target.container);
		}
	};
	const leave = () => {
		opened();
		if (!v) return;
		if (client) v.ttys.delete(client);
		client = null;
		void sweep(target.container);
	};

	stream.on('data', (chunk: Buffer) => {
		if (head) {
			// Hold output back until the tty announcement has gone by.
			head = Buffer.concat([head, chunk]);
			const a = head.indexOf(RS);
			const b = a === -1 ? -1 : head.indexOf(RS, a + 1);
			if (b === -1 && head.length < 256) return;
			if (b !== -1) client = head.subarray(a + 1, b).toString().trim() || null;
			chunk = b === -1 ? head : head.subarray(b + 1);
			opened();
			if (!chunk.length) return;
		}
		if (ws.readyState !== ws.OPEN) return;
		ws.send(chunk, { binary: true });
		// A slow browser shouldn't make us buffer a whole build log in memory.
		if (ws.bufferedAmount > 4 * 1024 * 1024) {
			stream.pause();
			const resume = setInterval(() => {
				if (ws.readyState !== ws.OPEN || ws.bufferedAmount < 512 * 1024) {
					clearInterval(resume);
					stream.resume();
				}
			}, 50);
		}
	});
	const end = () => {
		// Whatever came before the announcement (an error, say) still reaches the browser.
		if (head?.length && ws.readyState === ws.OPEN) ws.send(head, { binary: true });
		opened();
		if (ws.readyState === ws.OPEN) ws.close(1000, 'ended');
	};
	stream.on('end', end);
	stream.on('close', end);
	stream.on('error', end);
	stream.once('close', leave);

	ws.on('message', (data, isBinary) => {
		if (isBinary) {
			stream.write(data as Buffer);
			return;
		}
		let msg: { t?: string; d?: unknown; c?: unknown; r?: unknown };
		try {
			msg = JSON.parse(data.toString());
		} catch {
			return;
		}
		if (msg.t === 'i' && typeof msg.d === 'string') stream.write(msg.d);
		else if (msg.t === 'r') void resize(clamp(String(msg.c), 20, 500, cols), clamp(String(msg.r), 5, 200, rows));
		// The browser's heartbeat: an empty frame back tells it the line is still up.
		else if (msg.t === 'p') ws.send(Buffer.alloc(0), { binary: true });
	});
	// Closing the exec doesn't end the tmux client (see VIEWER): the sweep does. Claude keeps running.
	ws.on('close', () => stream.destroy());
	ws.on('error', () => stream.destroy());
}
