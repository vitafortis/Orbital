import { json } from '@sveltejs/kit';
import { BadRequest, body, handler, str } from '#lib/server/http.ts';
import { parseAccountFields } from '#lib/server/account-input.ts';
import { accountsFor } from '#lib/server/owned.ts';
import { createAccount } from '#lib/server/store.ts';
import { ACCOUNT_KINDS, isAccountKind } from '#lib/providers.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => json(accountsFor(locals.user));

/**
 * Adds an account. Sign-in kinds then sign in through /login; the others bring their keys.
 * Admins add the organization's (or, with `personal`, their own); members only their own,
 * and only sign-ins to their own plan, not keys billed to the organization.
 */
export const POST: RequestHandler = handler(async ({ request, locals }) => {
	const b = await body(request);
	if (!isAccountKind(b.kind)) throw new BadRequest('Pick how this account connects');
	const name = str(b, 'name', { required: true, max: 80 })!;
	const personal = locals.user?.role !== 'admin' || b.personal === true;
	if (personal && !ACCOUNT_KINDS[b.kind].personal) throw new BadRequest(`Your own accounts are sign-ins to your own plan (Claude, ChatGPT or Google). ${ACCOUNT_KINDS[b.kind].label} is for the organization: an admin adds it.`);
	const ownerId = personal ? (locals.user?.id ?? null) : null;
	return json(createAccount({ name, kind: b.kind, ...parseAccountFields(b.kind, b), ownerId }), { status: 201 });
});
