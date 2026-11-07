import { Marked, type Tokens } from 'marked';

/**
 * The agent's Markdown as HTML for the Read tab. What it writes can quote anything (a web page,
 * a file), so raw HTML is shown as text, links go only to http(s) and mailto and open in a new
 * tab, and images are links rather than loaded.
 */
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeHref = (href: string) => (/^(?:https?:|mailto:)/i.test(href.trim()) ? href.trim() : null);

const md = new Marked({
	gfm: true,
	async: false,
	renderer: {
		html: ({ text }: Tokens.HTML | Tokens.Tag) => escape(text),
		link({ href, title, tokens }: Tokens.Link) {
			const text = this.parser.parseInline(tokens);
			const url = safeHref(href);
			if (!url) return text;
			return `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ''} target="_blank" rel="noopener noreferrer">${text}</a>`;
		},
		image({ href, text }: Tokens.Image) {
			const url = safeHref(href);
			return url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(text || url)}</a>` : escape(text);
		}
	}
});

export function renderMarkdown(text: string): string {
	return md.parse(text) as string;
}
