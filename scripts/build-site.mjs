/**
 * Builds Orbital's site into _site/: the landing page (site/index.html) and the docs
 * (site/docs/*.md, rendered with marked), with the screenshots and logo from docs/.
 * GitHub Pages publishes it (.github/workflows/pages.yml); locally: node scripts/build-site.mjs.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Marked } from 'marked';

const OUT = '_site';
/** The docs, in reading order: slug and the name in the sidebar. */
const PAGES = [
	['index', 'Introduction'],
	['install', 'Install'],
	['sessions', 'Sessions'],
	['accounts', 'Model accounts'],
	['github', 'GitHub'],
	['library', 'Library'],
	['automations', 'Automations'],
	['aws', 'AWS'],
	['users', 'Sign-in and users'],
	['security', 'Security model'],
	['configuration', 'Configuration']
];

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slugify = (text) =>
	text
		.toLowerCase()
		.replace(/<[^>]+>/g, '')
		.replace(/&[a-z]+;/g, '')
		.replace(/[^a-z0-9 -]/g, '')
		.trim()
		.replace(/\s+/g, '-');

function render(md) {
	const toc = [];
	const used = new Set();
	const marked = new Marked({
		gfm: true,
		renderer: {
			heading({ tokens, depth }) {
				const html = this.parser.parseInline(tokens);
				if (depth === 1) return `<h1>${html}</h1>\n`;
				let id = slugify(html);
				for (let n = 2; used.has(id); n++) id = `${slugify(html)}-${n}`;
				used.add(id);
				if (depth === 2) toc.push({ id, text: html.replace(/<[^>]+>/g, '') });
				return `<h${depth} id="${id}">${html}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
			}
		}
	});
	// Wide tables scroll on their own, not the page.
	const html = marked.parse(md).replaceAll('<table>', '<div class="table"><table>').replaceAll('</table>', '</table></div>');
	return { html, toc };
}
const shell = ({ title, description, body, depth }) => {
	const up = depth ? '../' : '';
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<title>${escape(title)}</title>
	<meta name="description" content="${escape(description)}" />
	<link rel="icon" href="${up}logo.svg" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" />
	<link rel="stylesheet" href="${up}assets/site.css" />
</head>
<body>
	<header class="top">
		<div class="wrap">
			<a class="brand" href="${up}index.html"><img src="${up}logo.svg" alt="" />Orbital</a>
			<nav>
				<a href="${up}docs/index.html" aria-current="page">Docs</a>
				<a class="hide-sm" href="${up}docs/install.html">Install</a>
				<a class="hide-sm" href="${up}docs/security.html">Security</a>
				<a href="https://github.com/vitafortis/Orbital">GitHub</a>
			</nav>
		</div>
	</header>
${body}
</body>
</html>
`;
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'docs'), { recursive: true });
cpSync('site/index.html', join(OUT, 'index.html'));
cpSync('site/assets', join(OUT, 'assets'), { recursive: true });
cpSync('docs/screenshots', join(OUT, 'screenshots'), { recursive: true, filter: (f) => !f.endsWith('.md') });
cpSync('docs/logo.svg', join(OUT, 'logo.svg'));
// Project pages are served as-is: no Jekyll.
writeFileSync(join(OUT, '.nojekyll'), '');

const present = PAGES.filter(([slug]) => existsSync(`site/docs/${slug}.md`));
for (const [i, [slug, name]] of present.entries()) {
	const md = readFileSync(`site/docs/${slug}.md`, 'utf8');
	const { html, toc } = render(md);
	const title = md.match(/^# (.+)$/m)?.[1] ?? name;
	const intro = md.replace(/^# .+$/m, '').trim().split(/\n\s*\n/)[0]?.replace(/[*_`[\]]|\(.*?\)/g, '').slice(0, 200) ?? '';
	const prev = present[i - 1];
	const next = present[i + 1];
	const body = `	<div class="wrap docs">
		<nav class="side" aria-label="Docs">
			<div class="label">Docs</div>
${present.map(([s, n]) => `			<a href="${s}.html"${s === slug ? ' aria-current="page"' : ''}>${n}</a>`).join('\n')}
		</nav>
		<article class="prose">
${html}
			<nav class="pager" aria-label="Previous and next">
				${prev ? `<a href="${prev[0]}.html"><small>Previous</small>${prev[1]}</a>` : ''}
				${next ? `<a class="next" href="${next[0]}.html"><small>Next</small>${next[1]}</a>` : ''}
			</nav>
		</article>
		<aside class="toc" aria-label="On this page">
			${toc.length > 1 ? `<div class="label">On this page</div>\n${toc.map((t) => `			<a href="#${t.id}">${t.text}</a>`).join('\n')}` : ''}
		</aside>
	</div>`;
	writeFileSync(join(OUT, 'docs', `${slug}.html`), shell({ title: slug === 'index' ? 'Orbital docs' : `${title} · Orbital docs`, description: intro, body, depth: 1 }));
}
console.log(`Built ${OUT}/: the landing page and ${present.length} docs pages`);
