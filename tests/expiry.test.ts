import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceExpiry, expiryFor, expiryTimes, touchSession } from '#lib/server/sessions/expiry.ts';
import { parseExpiry } from '#lib/server/sessions/input.ts';

const H = 3600_000;
const at = (ms: number) => new Date(ms).toISOString();
const now = Date.parse('2026-11-19T12:00:00Z');
const settings = { idleStopHours: 4, deleteStoppedDays: 7 };
const running = { id: 'r', status: 'running' as const, lastStartedAt: at(now - 10 * H), stoppedAt: null, createdAt: at(now - 20 * H) };
const summary = (ms: number) => ({ updatedAt: at(ms) }) as never;

test('a running session stops after the idle time, from its last activity; never while working', () => {
	assert.equal(expiryTimes(running, { state: 'idle', summary: summary(now - 1 * H) }, settings).stopsAt, at(now + 3 * H));
	assert.equal(expiryTimes(running, { state: 'working', summary: summary(now - 9 * H) }, settings).stopsAt, null);
	assert.equal(expiryTimes(running, { state: 'idle', summary: null }, { ...settings, idleStopHours: 0 }).stopsAt, null, 'off');
	// Typing in its terminal counts as activity.
	touchSession('r', now - 0.5 * H);
	assert.equal(expiryTimes(running, { state: 'waiting', summary: summary(now - 6 * H) }, settings).stopsAt, at(now + 3.5 * H));
});

test('a stopped (or failed) session is deleted the set days after it stopped', () => {
	const stopped = { id: 's', status: 'stopped' as const, lastStartedAt: at(now - 50 * H), stoppedAt: at(now - 48 * H), createdAt: at(now - 99 * H) };
	assert.equal(expiryTimes(stopped, { state: 'unknown', summary: null }, settings).deletesAt, at(now - 48 * H + 7 * 24 * H));
	assert.equal(expiryTimes({ ...stopped, status: 'error', stoppedAt: null }, { state: 'unknown', summary: null }, settings).deletesAt, at(now - 50 * H + 7 * 24 * H));
	assert.equal(expiryTimes(stopped, { state: 'unknown', summary: null }, { ...settings, deleteStoppedDays: 0 }).deletesAt, null);
});

test('what is due is stopped or deleted; a failure is left for the next poll', async () => {
	const done: string[] = [];
	const r = await enforceExpiry(
		[
			{ id: 'a', name: 'a', stopsAt: at(now - 1), deletesAt: null },
			{ id: 'b', name: 'b', stopsAt: at(now + H), deletesAt: null },
			{ id: 'c', name: 'c', stopsAt: null, deletesAt: at(now - 1) },
			{ id: 'd', name: 'd', stopsAt: at(now - 1), deletesAt: null }
		],
		{ stop: async (id) => (id === 'd' ? Promise.reject(new Error('docker')) : done.push(`stop ${id}`)), remove: async (id) => done.push(`delete ${id}`) },
		now
	);
	assert.deepEqual(done, ['stop a', 'delete c']);
	assert.deepEqual(r, { stopped: ['a'], deleted: ['c'] });
	// The failed one waits five minutes before the next try.
	const again = await enforceExpiry([{ id: 'd', name: 'd', stopsAt: at(now - 1), deletesAt: null }], { stop: async () => done.push('stop d'), remove: async () => {} }, now + 60_000);
	assert.deepEqual(again.stopped, []);
	const later = await enforceExpiry([{ id: 'd', name: 'd', stopsAt: at(now - 1), deletesAt: null }], { stop: async () => done.push('stop d'), remove: async () => {} }, now + 6 * 60_000);
	assert.deepEqual(later.stopped, ['d']);
});

test("a session's expiry: its own, else the defaults for people's or automations' sessions", () => {
	const settings = { idleStopHours: 8, deleteStoppedDays: 7, autoIdleStopHours: 1, autoDeleteStoppedDays: 0.5 };
	const issue = { issueId: 'i', identifier: 'ENG-1', url: 'https://linear.app/x' };
	assert.deepEqual(expiryFor({ idleStopHours: null, deleteStoppedDays: null, linear: null }, settings), { idleStopHours: 8, deleteStoppedDays: 7 });
	assert.deepEqual(expiryFor({ idleStopHours: null, deleteStoppedDays: null, linear: issue }, settings), { idleStopHours: 1, deleteStoppedDays: 0.5 }, 'started by a Linear rule');
	assert.deepEqual(expiryFor({ idleStopHours: 0, deleteStoppedDays: 2, linear: issue }, settings), { idleStopHours: 0, deleteStoppedDays: 2 }, 'its own wins; 0 is never');
	// What a form sends: empty is the default, numbers its own, nonsense refused.
	assert.deepEqual(parseExpiry({ idleStopHours: '', deleteStoppedDays: '0.25' }), { idleStopHours: null, deleteStoppedDays: 0.25 });
	assert.deepEqual(parseExpiry({}), { idleStopHours: null, deleteStoppedDays: null });
	assert.throws(() => parseExpiry({ idleStopHours: -1 }), /from 0/);
});
