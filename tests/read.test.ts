import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainLine, turnMatches, turnOutcome } from '#lib/read.ts';

const turn = (...texts: string[]) => ({ prompt: 'what is left?', at: null, parts: texts.map((text) => ({ kind: 'text' as const, text })) });

test('a turn in one line: the first sentence of its last reply', () => {
	assert.equal(turnOutcome(turn('Checking.', '**Fixed the token renewal;** PR #11 is open. Details:\n\n- one')), 'Fixed the token renewal; PR #11 is open.');
	assert.equal(turnOutcome(turn('## Where things stand\n\nThree items left. Here they are.')), 'Three items left.');
	assert.equal(turnOutcome({ prompt: 'x', at: null, parts: [{ kind: 'tools', tools: ['Bash: ls'] }] }), null);
	assert.equal(turnOutcome(turn('a'.repeat(300)))!.length, 160);
});

test('plainLine drops Markdown, code and links', () => {
	assert.equal(plainLine('Run `pnpm test`, see [the PR](https://x) and:\n```sh\nrm -rf /\n```\n> quoted'), 'Run pnpm test, see the PR and: quoted');
});

test('search matches every word, in the prompt or the replies', () => {
	const t = { prompt: 'Set up GlitchTip', at: null, parts: [{ kind: 'text' as const, text: 'Running at localhost:8000' }, { kind: 'tools' as const, tools: ['Bash: docker compose up'] }] };
	assert.ok(turnMatches(t, 'glitchtip localhost'));
	assert.ok(turnMatches(t, 'docker'));
	assert.ok(!turnMatches(t, 'glitchtip sentry'));
	assert.ok(turnMatches(t, '  '));
});
