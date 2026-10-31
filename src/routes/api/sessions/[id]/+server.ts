import { json } from '@sveltejs/kit';
import { BadRequest, body, handler, NotFound } from '#lib/server/http.ts';
import { AGENT_LABEL, AGENT_PERMISSION_MODES } from '#lib/providers.ts';
import { parseAwsProfileIds, parseModel, parseName, parsePermissionMode } from '#lib/server/sessions/input.ts';
import { writeAwsCredentials } from '#lib/server/sessions/aws.ts';
import { pokeLive } from '#lib/server/sessions/live.ts';
import { deleteSession } from '#lib/server/sessions/runtime.ts';
import { getAccount, getGithubAccount, getSession, updateSession } from '#lib/server/store.ts';
import { writeGithubCredentials } from '#lib/server/sessions/github.ts';
import type { RequestHandler } from './$types';

function load(id: string) {
	const s = getSession(id);
	if (!s) throw new NotFound('Session not found');
	return s;
}

export const GET: RequestHandler = handler(({ params }) => json(load(params.id)));

/** Settings that apply from the next launch (Restart Claude, or Stop then Start). */
export const PATCH: RequestHandler = handler(async ({ params, request }) => {
	const s = load(params.id);
	const b = await body(request);
	const patch: Parameters<typeof updateSession>[1] = {};
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
		patch.accountId = b.accountId;
	}
	if ('githubAccountId' in b) {
		const gid = typeof b.githubAccountId === 'string' && b.githubAccountId ? b.githubAccountId : null;
		if (gid && !getGithubAccount(gid)) throw new NotFound('GitHub account not found');
		patch.githubAccountId = gid;
	}
	if (patch.permissionMode && !AGENT_PERMISSION_MODES[s.agent].includes(patch.permissionMode)) {
		throw new BadRequest(`${AGENT_LABEL[s.agent]} doesn't have that permission mode`);
	}
	updateSession(params.id, patch);
	const updated = load(params.id);
	// A running session switches GitHub accounts at once: git and gh read the token from files.
	if ('githubAccountId' in patch && (updated.status === 'running' || updated.status === 'starting')) writeGithubCredentials(updated);
	// AWS credentials too: added profiles work, removed ones stop working, without a restart.
	if ('awsProfileIds' in patch && (updated.status === 'running' || updated.status === 'starting')) await writeAwsCredentials(updated);
	return json(updated);
});

/** Stops the session and deletes its repo clone, home folder and transcripts. */
export const DELETE: RequestHandler = handler(async ({ params }) => {
	await deleteSession(params.id);
	pokeLive();
	return json({ ok: true });
});
