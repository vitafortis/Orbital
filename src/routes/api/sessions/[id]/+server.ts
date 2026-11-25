import { json } from '@sveltejs/kit';
import { accountForSession, githubAccountForSession } from '#lib/server/owned.ts';
import { canChangeSetup } from '#lib/access.ts';
import { BadRequest, body, Forbidden, handler, NotFound } from '#lib/server/http.ts';
import { AGENT_LABEL, AGENT_PERMISSION_MODES } from '#lib/providers.ts';
import { parseAwsProfileIds, parseExpiry, parseModel, parseName, parsePermissionMode } from '#lib/server/sessions/input.ts';
import { writeAwsCredentials } from '#lib/server/sessions/aws.ts';
import { pokeLive } from '#lib/server/sessions/live.ts';
import { deleteSession } from '#lib/server/sessions/runtime.ts';
import { getAccount, getGithubAccount, getSession, setSessionOwner, updateSession } from '#lib/server/store.ts';
import { writeGithubCredentials } from '#lib/server/sessions/github.ts';
import type { RequestHandler } from './$types';

function load(id: string) {
	const s = getSession(id);
	if (!s) throw new NotFound('Session not found');
	return s;
}

export const GET: RequestHandler = handler(({ params }) => json(load(params.id)));

/** What a session runs as and with: its owner's to change, or an admin's for a shared session. */
const SETUP = ['model', 'permissionMode', 'remoteControl', 'awsProfileIds', 'accountId', 'githubAccountId', 'watchable', 'idleStopHours', 'deleteStoppedDays'];

/**
 * Settings that apply from the next launch (Restart Claude, or Stop then Start), and sharing.
 * Anyone who can control it may rename it; its setup is for whoever canChangeSetup; making it
 * shared (the organization's) or not is for admins.
 */
export const PATCH: RequestHandler = handler(async ({ params, request, locals }) => {
	const s = load(params.id);
	const b = await body(request);
	const who = locals.user;
	if (SETUP.some((k) => k in b) && !canChangeSetup(who, s)) {
		throw new Forbidden(s.shared ? "This is a shared session: only an admin changes what it runs as." : "Only the person who started this session (or an admin) can change what it runs as.");
	}
	if ('shared' in b && who?.role !== 'admin') throw new Forbidden('Only an admin can share a session with everyone, or stop sharing it');
	const patch: Parameters<typeof updateSession>[1] = {};
	const shared = 'shared' in b ? b.shared === true : s.shared;
	// Whose own accounts it may use: nobody's once it's shared.
	const user = shared ? null : s.ownerId;
	if ('watchable' in b) patch.watchable = b.watchable === true;
	if ('idleStopHours' in b || 'deleteStoppedDays' in b) {
		const e = parseExpiry(b);
		if ('idleStopHours' in b) patch.idleStopHours = e.idleStopHours;
		if ('deleteStoppedDays' in b) patch.deleteStoppedDays = e.deleteStoppedDays;
	}
	if ('name' in b) patch.name = parseName(b.name);
	if ('model' in b) patch.model = parseModel(b.model);
	if ('permissionMode' in b) patch.permissionMode = parsePermissionMode(b.permissionMode);
	if ('remoteControl' in b) patch.remoteControl = b.remoteControl !== false;
	if ('awsProfileIds' in b) patch.awsProfileIds = parseAwsProfileIds(b.awsProfileIds);
	if (typeof b.accountId === 'string') {
		const account = getAccount(b.accountId);
		if (!account) throw new NotFound('Model account not found');
		// Conversations belong to the agent that had them.
		if (account.agent !== s.agent) throw new BadRequest(`This session runs ${AGENT_LABEL[s.agent]}. Pick one of its accounts, or start a new session.`);
		accountForSession(account.id, user);
		patch.accountId = b.accountId;
	}
	if ('githubAccountId' in b) {
		const gid = typeof b.githubAccountId === 'string' && b.githubAccountId ? b.githubAccountId : null;
		if (gid && !getGithubAccount(gid)) throw new NotFound('GitHub account not found');
		githubAccountForSession(gid, user);
		patch.githubAccountId = gid;
	}
	if (patch.permissionMode && !AGENT_PERMISSION_MODES[s.agent].includes(patch.permissionMode)) {
		throw new BadRequest(`${AGENT_LABEL[s.agent]} doesn't have that permission mode`);
	}
	if ('shared' in b && shared !== s.shared) {
		if (shared) {
			// The organization's: its accounts must be too, or one person's would act for everyone.
			try {
				accountForSession(patch.accountId ?? s.accountId, null);
				githubAccountForSession('githubAccountId' in patch ? (patch.githubAccountId ?? null) : s.githubAccountId, null);
			} catch {
				throw new BadRequest("It runs on someone's own account or GitHub sign-in. A shared session uses the organization's: switch it to one of those first.");
			}
		} else if (!s.ownerId || s.ownerId === 'open') {
			// Nobody started it (from before sign-in, or an automation): it becomes the admin's own.
			setSessionOwner(s.id, who?.id ?? null);
		}
		patch.shared = shared;
	}
	updateSession(params.id, patch);
	const updated = load(params.id);
	// A running session switches GitHub accounts at once: git and gh read the token from files.
	if ('githubAccountId' in patch && (updated.status === 'running' || updated.status === 'starting')) writeGithubCredentials(updated);
	// AWS credentials too: added profiles work, removed ones stop working, without a restart.
	if ('awsProfileIds' in patch && (updated.status === 'running' || updated.status === 'starting')) await writeAwsCredentials(updated);
	return json(updated);
});

/** Stops the session and deletes its repo clone, home folder and transcripts. A shared one: admins only. */
export const DELETE: RequestHandler = handler(async ({ params, locals }) => {
	if (!canChangeSetup(locals.user, load(params.id))) throw new Forbidden('Only an admin can delete a shared session');
	await deleteSession(params.id);
	pokeLive();
	return json({ ok: true });
});
