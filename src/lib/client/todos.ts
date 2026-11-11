import { goto } from '$app/navigation';
import { api, errorMessage } from './api.ts';
import { toast } from './state.svelte.ts';
import type { TodoItem, TodoWhere } from '#lib/types.ts';

export const WHERE_LABEL: Record<TodoWhere, string> = {
	'your-machine': 'On your machine',
	'session-shell': "In the session's Shell",
	browser: 'In a browser',
	other: ''
};

const TELL = 'orb.todo.tell';

/** Whether marking an item done tells its session (remembered in this browser; on by default). */
export function tellByDefault(): boolean {
	try {
		return localStorage.getItem(TELL) !== '0';
	} catch {
		return true;
	}
}

export function setTellByDefault(on: boolean) {
	try {
		localStorage.setItem(TELL, on ? '1' : '0');
	} catch {}
}

export async function markTodo(t: TodoItem, done: boolean, tell: boolean): Promise<boolean> {
	try {
		const r = await api.patch<{ told: boolean }>(`/api/sessions/${t.sessionId}/todos/${t.id}`, { done, tell });
		if (r.told) toast('success', 'Done', `Told the session: “Done: ${t.title}”`);
		return true;
	} catch (err) {
		toast('error', "Couldn't update it", errorMessage(err));
		return false;
	}
}

export async function addTodo(sessionId: string, input: { title: string; command?: string; where?: TodoWhere; why?: string }): Promise<boolean> {
	try {
		await api.post(`/api/sessions/${sessionId}/todos`, input);
		return true;
	} catch (err) {
		toast('error', "Couldn't add it", errorMessage(err));
		return false;
	}
}

/** Opens the session's Shell tab with the command typed in, for you to check and press Enter. */
export function runInShell(t: Pick<TodoItem, 'sessionId' | 'command'>) {
	if (t.command) void goto(`/s/${t.sessionId}?run=${encodeURIComponent(t.command)}`);
}
