import { json } from '@sveltejs/kit';
import { BadRequest, handler, NotFound } from '#lib/server/http.ts';
import { MAX_ATTACHMENT_BYTES, saveAttachment } from '#lib/server/sessions/attachments.ts';
import { getSession } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** One file as the raw body, its name in X-Filename; answers with its path in the container. */
export const POST: RequestHandler = handler(async ({ params, request }) => {
	if (!getSession(params.id)) throw new NotFound('Session not found');
	if (Number(request.headers.get('content-length') ?? 0) > MAX_ATTACHMENT_BYTES) throw new BadRequest('Files can be up to 25 MB');
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (!bytes.length) throw new BadRequest('The file is empty');
	if (bytes.length > MAX_ATTACHMENT_BYTES) throw new BadRequest('Files can be up to 25 MB');
	const name = decodeURIComponent(request.headers.get('x-filename') ?? '') || 'file';
	return json({ path: saveAttachment(params.id, name, bytes) });
});
