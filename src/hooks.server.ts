import { json, redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { authenticate, proxyIdentity, startSession } from '#lib/server/auth.ts';
import { publicUrl } from '#lib/server/origin.ts';
import { startLinear } from '#lib/server/linear.ts';
import { startLive } from '#lib/server/sessions/live.ts';
import { adoptLegacyDirs } from '#lib/server/sessions/storage.ts';
import { handleUpgrade } from '#lib/server/terminal/upgrade.ts';
import { getSession } from '#lib/server/store.ts';
import { apiDenied } from '#lib/access.ts';

export const init: ServerInit = () => {
	// server.js passes WebSocket upgrades (terminals) here.
	globalThis.__orbUpgrade = handleUpgrade;
	try {
		adoptLegacyDirs();
	} catch (err) {
		console.error('[orbital] renaming .ccm folders failed:', err);
	}
	startLive();
	startLinear();
};

const PUBLIC = ['/login', '/setup', '/api/auth/', '/api/health'];

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	const method = event.request.method;
	const isApi = pathname.startsWith('/api/');

	// JSON APIs must come from our own host. Browsers always send Origin on
	// cross-site and non-GET requests, so a mismatch means a forged request.
	// Hosts are compared (not full origins) so it works by IP, hostname, or
	// behind a TLS-terminating proxy without configuring ORIGIN.
	if (isApi && method !== 'GET') {
		const origin = event.request.headers.get('origin');
		if (origin) {
			const h = event.request.headers;
			const allowed = [event.url.host, h.get('host'), h.get('x-forwarded-host')].filter(Boolean);
			let host = '';
			try {
				host = new URL(origin).host;
			} catch {}
			if (!allowed.includes(host)) return json({ message: 'Cross-origin request blocked' }, { status: 403 });
		}
	}

	const visible = publicUrl(event.url, event.request.headers);
	event.locals.origin = visible.origin;
	event.locals.secure = visible.protocol === 'https:';

	try {
		event.locals.ip = event.getClientAddress();
	} catch {}
	let { state, user } = authenticate(event.cookies);

	// Signed in by the reverse proxy: start (or switch) our own session to match, so the
	// terminal WebSockets, which only carry the cookie, are signed in too.
	if (state === 'anonymous' || state === 'authenticated') {
		const id = proxyIdentity(event.request.headers, event.locals.ip);
		if (id && 'denied' in id) return new Response(id.denied, { status: 403 });
		if (id && id.user.id !== user?.id) {
			startSession(event.cookies, id.user.id, visible.protocol === 'https:');
			state = 'authenticated';
			user = id.user;
		}
	}
	event.locals.auth = state;
	event.locals.user = user;

	if (!PUBLIC.some((p) => pathname.startsWith(p))) {
		if (state === 'setup') {
			if (isApi) return json({ message: 'Setup required' }, { status: 401 });
			redirect(303, '/setup');
		}
		if (state === 'anonymous') {
			if (isApi) return json({ message: 'Not signed in' }, { status: 401 });
			redirect(303, `/login?next=${encodeURIComponent(pathname + event.url.search)}`);
		}
	}

	// Roles, for every change through the API (the pages only hide what you can't do).
	if (isApi && user) {
		const denied = apiDenied(user, method, pathname, (id) => {
			const s = getSession(id);
			return s ? s.ownerId : undefined;
		});
		if (denied) return json({ message: denied }, { status: 403 });
	}

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
