import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationInfo, describeTool, excerpt, readTurns, summarizeTranscript } from '#lib/transcript.ts';

const line = (o: unknown) => JSON.stringify(o);
const user = (content: unknown, extra = {}) => line({ type: 'user', message: { role: 'user', content }, ...extra });
const assistant = (content: unknown[]) => line({ type: 'assistant', message: { role: 'assistant', content } });

const transcript = [
	line({ type: 'custom-title', customTitle: 'api' }),
	user('<command-name>/clear</command-name>'),
	user('Fix the failing login test'),
	user('Caveat: local command output', { isMeta: true }),
	assistant([{ type: 'text', text: 'Looking at the test.' }, { type: 'tool_use', name: 'TaskCreate', input: { subject: 'Reproduce' } }]),
	assistant([{ type: 'tool_use', name: 'TaskCreate', input: { subject: 'Fix it' } }]),
	assistant([{ type: 'tool_use', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }]),
	user([{ type: 'tool_result', content: 'ok' }]),
	assistant([{ type: 'tool_use', name: 'Bash', input: { command: 'npm test\nmore' } }]),
	'{"partial": ',
	assistant([{ type: 'text', text: 'All green now.' }]),
	line({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent chatter' }] } })
].join('\n');

test('summarizeTranscript: prompt, reply, tool and tasks', () => {
	const s = summarizeTranscript(transcript, 'conv-1', '2026-01-01T00:00:00.000Z');
	assert.equal(s.title, 'api');
	assert.equal(s.lastPrompt, 'Fix the failing login test');
	assert.equal(s.lastReply, 'All green now.');
	assert.equal(s.lastTool, 'Bash: npm test');
	assert.equal(s.messages, 3);
	assert.deepEqual(s.todos, [
		{ content: 'Reproduce', status: 'completed' },
		{ content: 'Fix it', status: 'pending' }
	]);
});

test('TodoWrite replaces the list', () => {
	const t = [
		assistant([{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] } }]),
		assistant([{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'c', status: 'weird' }] } }])
	].join('\n');
	assert.deepEqual(summarizeTranscript(t, 'x', '').todos, [{ content: 'c', status: 'pending' }]);
});

test('conversationInfo and excerpt', () => {
	assert.deepEqual(conversationInfo(transcript), { title: 'api', firstPrompt: 'Fix the failing login test', messages: 3 });
	const e = excerpt(transcript);
	assert.match(e, /^USER: Fix the failing login test/m);
	assert.match(e, /^TOOL Bash: npm test$/m);
	assert.doesNotMatch(e, /subagent/);
	assert.ok(excerpt(transcript, 20).length < e.length);
});

test('describeTool falls back to the name', () => {
	assert.equal(describeTool({ name: 'Read', input: { file_path: '/a/b.ts' } }), 'Read: /a/b.ts');
	assert.equal(describeTool({ name: 'Think', input: {} }), 'Think');
});

test('readTurns: prompts, then the words and tools in between, in order', () => {
	const entries = [
		{ type: 'user', timestamp: '2026-11-07T10:00:00Z', message: { role: 'user', content: 'what is left?' } },
		{ type: 'assistant', message: { content: [{ type: 'text', text: 'Checking.' }] } },
		{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'gh issue list' } }] } },
		{ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
		{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } },
		{ type: 'assistant', message: { content: [{ type: 'text', text: '## Left\n\n- one' }] } },
		{ type: 'assistant', message: { content: [{ type: 'text', text: 'Want me to start?' }] } },
		{ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent' }] } },
		{ type: 'something-new', foo: 1 },
		'not json'
	];
	const text = entries.map((l) => (typeof l === 'string' ? l : line(l))).join('\n');
	assert.deepEqual(readTurns(text), [
		{
			prompt: 'what is left?',
			at: '2026-11-07T10:00:00Z',
			parts: [
				{ kind: 'text', text: 'Checking.' },
				{ kind: 'tools', tools: ['Bash: gh issue list', 'Read: a.ts'] },
				{ kind: 'text', text: '## Left\n\n- one\n\nWant me to start?' }
			]
		}
	]);
});
