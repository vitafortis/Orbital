import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Moved under Settings; old links (bookmarks, Linear comments) still land.
export const load: PageServerLoad = ({ url }) => redirect(308, `/settings/automations${url.search}`);
