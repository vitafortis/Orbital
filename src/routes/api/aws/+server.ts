import { json } from '@sveltejs/kit';
import { listAwsLogins, listAwsProfiles } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** AWS sign-ins and profiles (no tokens: those never leave the server). */
export const GET: RequestHandler = () => json({ logins: listAwsLogins(), profiles: listAwsProfiles() });
