<script lang="ts">
	/**
	 * A session's or a Linear rule's own expiry: hours idle before it stops, days stopped before
	 * it's deleted. Empty: the default, shown as the placeholder; 0: never.
	 */
	let {
		idleStopHours = $bindable(),
		deleteStoppedDays = $bindable(),
		defaults,
		id = 'exp',
		onchange
	}: {
		idleStopHours: number | null;
		deleteStoppedDays: number | null;
		/** What empty means: the defaults this would follow (0: never). */
		defaults: { idleStopHours: number; deleteStoppedDays: number };
		id?: string;
		/** Called after a field changes (with both values), e.g. to save at once. */
		onchange?: (v: { idleStopHours: number | null; deleteStoppedDays: number | null }) => void;
	} = $props();

	const hint = (n: number, unit: string) => (n > 0 ? `Default: ${n} ${unit}` : 'Default: never');
	const read = (v: string) => (v.trim() === '' ? null : Math.max(0, Number(v)));
	function set(which: 'idle' | 'del', v: string) {
		if (which === 'idle') idleStopHours = read(v);
		else deleteStoppedDays = read(v);
		onchange?.({ idleStopHours, deleteStoppedDays });
	}
</script>

<div class="grid grid-cols-2 gap-2">
	<div>
		<label class="label" for="{id}-idle">Stop when idle (hours)</label>
		<input id="{id}-idle" class="input h-8 text-xs" type="number" min="0" step="0.25" placeholder={hint(defaults.idleStopHours, 'h')} value={idleStopHours ?? ''} onchange={(e) => set('idle', e.currentTarget.value)} />
	</div>
	<div>
		<label class="label" for="{id}-del">Delete when stopped (days)</label>
		<input id="{id}-del" class="input h-8 text-xs" type="number" min="0" step="0.25" placeholder={hint(defaults.deleteStoppedDays, 'd')} value={deleteStoppedDays ?? ''} onchange={(e) => set('del', e.currentTarget.value)} />
	</div>
</div>
