import { json } from '@sveltejs/kit';
import { handler } from '#lib/server/http.ts';
import { repoOwners } from '#lib/server/github.ts';
import type { RequestHandler } from './$types';

/** Each token's organizations, for a new repo's owner. */
export const GET: RequestHandler = handler(async () => json(await repoOwners()));
