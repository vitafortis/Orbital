<script lang="ts">
	import { Check, ShieldCheck } from '@lucide/svelte';
	import type { AwsProfile, SessionAws } from '#lib/types.ts';

	/** AWS profiles to give a session, as toggles; with `status`, what each one got. */
	let {
		profiles,
		value,
		onchange,
		status = null,
		disabled = false
	}: { profiles: AwsProfile[]; value: string[]; onchange: (ids: string[]) => void; status?: SessionAws[] | null; disabled?: boolean } = $props();

	const toggle = (id: string) => onchange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
	const stateOf = (id: string) => status?.find((s) => s.profileId === id);
</script>

<div class="flex flex-wrap gap-1.5">
	{#each profiles as p (p.id)}
		{@const on = value.includes(p.id)}
		{@const st = on ? stateOf(p.id) : undefined}
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.75rem] transition-colors {on ? 'border-primary/60 bg-primary-soft text-foreground' : 'border-border text-muted-foreground hover:text-foreground'} {st?.error ? 'border-danger/60' : ''}"
			title="{p.roleName} in {p.accountName ?? p.accountId} · {p.region}{st?.error ? `\n${st.error}` : st?.expiresAt ? `\nCredentials good until ${new Date(st.expiresAt).toLocaleTimeString()}` : ''}"
			aria-pressed={on}
			{disabled}
			onclick={() => toggle(p.id)}
		>
			{#if on}<Check class="size-3.5" />{:else}<ShieldCheck class="size-3.5" />{/if}{p.name}
		</button>
	{/each}
</div>
{#if status?.some((s) => s.error && value.includes(s.profileId))}
	<p class="mt-1.5 text-xs text-danger">{status.find((s) => s.error && value.includes(s.profileId))?.error}</p>
{/if}
