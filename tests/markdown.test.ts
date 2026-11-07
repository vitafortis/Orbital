import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '#lib/client/markdown.ts';

test('formats the usual Markdown', () => {
	const html = renderMarkdown('## Next steps\n\n- **Security:** rotate keys\n- `pnpm test`\n\n| a | b |\n|---|---|\n| 1 | 2 |');
	assert.match(html, /<h2>Next steps<\/h2>/);
	assert.match(html, /<li><strong>Security:<\/strong> rotate keys<\/li>/);
	assert.match(html, /<code>pnpm test<\/code>/);
	assert.match(html, /<table>/);
});

test('raw HTML, script links and images are never live', () => {
	const html = renderMarkdown('<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)> [x](javascript:alert(1)) ![p](https://e.com/p.png) [ok](https://e.com)');
	assert.doesNotMatch(html, /<script|<img|javascript:/i);
	assert.match(html, /&lt;script&gt;/);
	assert.match(html, /<a href="https:\/\/e.com\/p.png" target="_blank" rel="noopener noreferrer">p<\/a>/);
	assert.match(html, /<a href="https:\/\/e.com" target="_blank" rel="noopener noreferrer">ok<\/a>/);
});
