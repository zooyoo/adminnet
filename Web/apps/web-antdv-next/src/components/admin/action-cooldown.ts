import { onScopeDispose, shallowRef } from 'vue';
export function useActionCooldown<T extends string>(milliseconds: number) {
	const active = shallowRef<T[]>([]);
	const timers = new Map<T, ReturnType<typeof setTimeout>>();
	function clear() {
		for (const timer of timers.values()) clearTimeout(timer);
		timers.clear();
		active.value = [];
	}
	function begin(action: T) {
		if (active.value.includes(action)) return false;
		active.value = [...active.value, action];
		timers.set(
			action,
			setTimeout(() => {
				timers.delete(action);
				active.value = active.value.filter((value) => value !== action);
			}, milliseconds)
		);
		return true;
	}
	onScopeDispose(clear);
	return { active, begin, clear };
}
