export function bytes(n: number | null | undefined): string {
	if (n == null) return '—';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	let v = n;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function ago(iso: string | null | undefined): string {
	if (!iso) return 'never';
	const s = (Date.now() - new Date(iso).getTime()) / 1000;
	if (s < 45) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86400) return `${Math.round(s / 3600)}h ago`;
	if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
	return new Date(iso).toLocaleDateString();
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A GitHub connection as pickers show it: its name, then the login it signs in as. */
export function githubLabel(a: { label: string | null; login: string }): string {
	return a.label ? `${a.label} · ${a.login}` : a.login;
}

/**
 * What kind of GitHub connection it is, and whose: an organization's fine-grained token reaches
 * only that org; a personal one only its user's repos; a classic token or a sign-in, whatever
 * its user can.
 */
export function githubKind(a: { kind: 'pat' | 'oauth'; scopes: string | null; login: string; resourceOwner: string | null }): { label: string; org: string | null } {
	if (a.kind === 'oauth') return { label: 'GitHub sign-in', org: null };
	if (a.scopes !== null) return { label: 'Classic token', org: null };
	if (a.resourceOwner && a.resourceOwner.toLowerCase() !== a.login.toLowerCase()) return { label: `Org token · ${a.resourceOwner}`, org: a.resourceOwner };
	return { label: a.resourceOwner ? 'Personal token' : 'Fine-grained token', org: null };
}
