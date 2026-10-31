import { toast } from './state.svelte.ts';

/**
 * Writes text to the clipboard, falling back to a hidden textarea where the async clipboard
 * API is missing (plain-http homelab addresses aren't a secure context). Browsers allow
 * either only just after a click or key press, so this fails when called later.
 */
export async function writeClipboard(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return true;
		}
		const focused = document.activeElement as HTMLElement | null;
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		focused?.focus();
		return ok;
	} catch {
		return false;
	}
}

/** Copies text and says whether it worked. */
export async function copyText(text: string, label = 'Copied to clipboard'): Promise<boolean> {
	const ok = await writeClipboard(text);
	if (ok) toast('success', label);
	else toast('error', 'Could not copy to the clipboard');
	return ok;
}
