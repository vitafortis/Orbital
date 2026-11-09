/** Notion's API, for checking an integration token and (later) publishing to it. */

export const NOTION_VERSION = '2022-06-28';

/** Who an integration token is: the integration's name and its workspace. Throws with Notion's reason. */
export async function notionWhoAmI(token: string): Promise<{ bot: string | null; workspace: string | null }> {
	const res = await fetch('https://api.notion.com/v1/users/me', {
		headers: { authorization: `Bearer ${token}`, 'notion-version': NOTION_VERSION }
	}).catch((err) => {
		throw new Error(`Couldn't reach Notion: ${err instanceof Error ? err.message : err}`);
	});
	const b = (await res.json().catch(() => ({}))) as { name?: string; message?: string; bot?: { workspace_name?: string } };
	if (!res.ok) throw new Error(res.status === 401 ? 'Notion turned the token down. Copy the internal integration secret again.' : `Notion: ${b.message ?? res.statusText}`);
	return { bot: b.name ?? null, workspace: b.bot?.workspace_name ?? null };
}
