import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHighlights } from '#lib/highlight.ts';

const rows = (text: string) => text.replace(/^\n/, '').split('\n');

test('a question in a reply, across its wrapped rows', () => {
	const screen = rows(`
⏺ I've updated the overview to sort by recency. The sidebar already did,
  so nothing changes there.

⏺ Want me to merge the two sections into one grid, or keep the stopped
  sessions in their own list?
`);
	assert.deepEqual(findHighlights(screen), [{ kind: 'question', from: 3, to: 4 }]);
});

test('things for you to do, and the list under a "Next steps" heading', () => {
	const screen = rows(`
⏺ Pushed the branch. You'll need to give the token write access before I
  can open the PR.

  Next steps:
  - Update the token's permissions
  - Tell me to try again

  The build passes.
`);
	assert.deepEqual(findHighlights(screen), [
		{ kind: 'action', from: 0, to: 1 },
		{ kind: 'action', from: 3, to: 3 },
		{ kind: 'action', from: 4, to: 4 },
		{ kind: 'action', from: 5, to: 5 }
	]);
});

test('leaves prompts, tool calls and output, code and the input box alone', () => {
	const screen = rows(`
> what does this do?

⏺ Bash(grep -n "foo?" src/x.ts)
  ⎿  12: const a = b ?? c?
     13: is this a question?

⏺ It checks \`x?\` and links to https://example.com/?q=1 for details.

────────────────────────────────────────
> Should I run it?
────────────────────────────────────────
  ? for shortcuts
`);
	assert.deepEqual(findHighlights(screen), []);
});

test('nothing on a blank or unrecognised screen', () => {
	assert.deepEqual(findHighlights([]), []);
	assert.deepEqual(findHighlights(['', '   ', '╭───╮', '│ ✻ Welcome │', '╰───╯']), []);
});

test('a real status report: urgent items, and the question at the end', () => {
	const screen = rows(`
  5. Left over from the enterprise review (not started)

  - Security:
    - Integration credentials are stored unencrypted.
    - Dependencies have 4 critical and 36 high vulnerabilities.
  - Marketing copy to fix: it claims per-team access and a guaranteed SLA. I'd fix this
    before Monday.

  6. Tabled earlier (still on the list)

  - The docs site rewrite.

  Want me to fix the marketing copy now, so it's in the release?

✻ Worked for 1m 54s · done 5:14 AM
                                              new task? /clear to save 150.8k tokens
`);
	assert.deepEqual(findHighlights(screen), [
		{ kind: 'urgent', from: 4, to: 4 },
		{ kind: 'urgent', from: 5, to: 6 },
		{ kind: 'question', from: 12, to: 12 }
	]);
});
