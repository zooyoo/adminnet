import { shallowRef } from 'vue';

import { defineStore } from 'pinia';

import { requestClient } from '#/api/request';
import { sessionBoundary } from '#/api/session';

export interface DictOption {
	label: string;
	value: number | string;
	color?: string;
	status?: number;
}

export const useReferenceStore = defineStore('admin-reference', () => {
	const dictionaries = shallowRef<Record<string, DictOption[]>>({});
	let pending: Promise<void> | undefined;
	let loaded = false;
	let epoch = 0;

	function load() {
		if (loaded) return Promise.resolve();
		if (pending) return pending;
		const version = sessionBoundary.version;
		const current = epoch;
		pending = requestClient
			.get<Record<string, DictOption[]>>('/api/sysDictType/allDictList')
			.then((data) => {
				if (version !== sessionBoundary.version || current !== epoch) return;
				dictionaries.value = Object.fromEntries(
					Object.entries(data ?? {}).map(([key, options]) => [
						key,
						options.filter((option) => option.status !== 2).map((option) => ({ ...option, value: key.endsWith('Enum') ? Number(option.value) : option.value })),
					])
				);
				loaded = true;
			})
			.finally(() => {
				if (current === epoch) pending = undefined;
			});
		return pending;
	}

	function options(code: string): DictOption[] {
		return dictionaries.value[code] ?? [];
	}

	function label(code: string, value: unknown) {
		return options(code).find((option) => String(option.value) === String(value))?.label ?? (value == null ? '' : String(value));
	}

	function $reset() {
		epoch += 1;
		pending = undefined;
		loaded = false;
		dictionaries.value = {};
	}

	return { $reset, dictionaries, load, options, label };
});
