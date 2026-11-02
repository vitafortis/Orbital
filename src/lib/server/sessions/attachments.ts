/**
 * Files you attach to a session (pasted screenshots, dropped logs), for the agent to read by
 * path. Kept in .orb, outside the repo so they're never committed, and deleted with the session.
 */
import { chownSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abs, ensureDirs, sessionRel } from './storage.ts';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const REL = '.orb/attachments';
const IN_CONTAINER = `/session/${REL}`;

/** A safe, unique file name: the time, then what's left of the original name. */
export function attachmentName(original: string, now = new Date()): string {
	const base = (original.split(/[\\/]/).pop() ?? '').normalize('NFKD');
	const clean = base.replace(/[^\w.-]+/g, '-').replace(/^[.-]+|-+$/g, '').slice(-80) || 'file';
	return `${now.toISOString().replace(/[:.]/g, '-')}-${clean}`;
}

/** Saves an attachment and returns its path inside the session's container. */
export function saveAttachment(sessionId: string, original: string, bytes: Uint8Array): string {
	const rel = `${sessionRel(sessionId)}/${REL}`;
	ensureDirs(rel);
	const name = attachmentName(original);
	const file = join(abs(rel), name);
	writeFileSync(file, bytes, { mode: 0o644 });
	if (process.getuid?.() === 0) chownSync(file, 1000, 1000);
	return `${IN_CONTAINER}/${name}`;
}
