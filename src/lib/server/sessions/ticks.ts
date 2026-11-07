/**
 * List items you ticked off in the Read tab, per session, so they stay ticked on every device.
 * Kept in .orb/read-ticks.json as keys the browser makes from each item's text.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { metaDir } from './storage.ts';

const MAX = 5000;
const file = (id: string) => join(metaDir(id), 'read-ticks.json');

export function readTicks(sessionId: string): string[] {
	try {
		const v = JSON.parse(readFileSync(file(sessionId), 'utf8'));
		return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
	} catch {
		return [];
	}
}

/** Ticks or unticks one item; the oldest are forgotten past MAX. */
export function setTick(sessionId: string, key: string, done: boolean): string[] {
	const keys = readTicks(sessionId).filter((k) => k !== key);
	if (done) keys.push(key);
	const kept = keys.slice(-MAX);
	writeFileSync(file(sessionId), JSON.stringify(kept));
	return kept;
}
