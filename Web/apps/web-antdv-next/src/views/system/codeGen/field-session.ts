import type { CodeGenField, CodeGenId } from '#/api/system/codegen';

import { cloneFields, validateCodeGenFields } from './codegen-model';

export interface FieldSessionState {
	id?: CodeGenId;
	rows: CodeGenField[];
	baseline: string;
	busy: boolean;
	error: string;
}
export interface FieldSessionApi {
	load: (id: CodeGenId, signal: AbortSignal) => Promise<CodeGenField[]>;
	save: (rows: CodeGenField[], signal: AbortSignal) => Promise<unknown>;
}
export function createFieldState(): FieldSessionState {
	return { rows: [], baseline: '', busy: false, error: '' };
}
export function createFieldSession(state: FieldSessionState, api: FieldSessionApi, boundary: { track: (controller: AbortController) => void; release: (controller: AbortController) => void }) {
	let generation = 0;
	let active: AbortController | undefined;
	function close() {
		generation += 1;
		active?.abort();
		if (active) boundary.release(active);
		active = undefined;
		Object.assign(state, createFieldState(), { id: undefined });
	}
	async function request(work: (signal: AbortSignal) => Promise<void>, fallback: string) {
		active?.abort();
		const controller = new AbortController();
		active = controller;
		const current = ++generation;
		state.busy = true;
		state.error = '';
		boundary.track(controller);
		try { await work(controller.signal); }
		catch { if (!controller.signal.aborted && current === generation) state.error = fallback; }
		finally {
			boundary.release(controller);
			if (current === generation) { state.busy = false; active = undefined; }
		}
	}
	function current(signal: AbortSignal, id: CodeGenId) { return !signal.aborted && state.id === id; }
	async function load(id: CodeGenId) {
		close();
		state.id = id;
		await request(async (signal) => {
			const rows = await api.load(id, signal);
			if (current(signal, id)) { state.rows = cloneFields(rows); state.baseline = JSON.stringify(state.rows); }
		}, '字段加载失败，请重新加载。');
	}
	async function save() {
		if (state.busy || state.id === undefined) return false;
		state.error = validateCodeGenFields(state.rows);
		if (state.error) return false;
		const id = state.id;
		const draft = cloneFields(state.rows);
		let saved = false;
		await request(async (signal) => {
			await api.save(draft, signal);
			if (!current(signal, id)) return;
			saved = true;
			state.baseline = JSON.stringify(draft);
			try {
				const rows = await api.load(id, signal);
				if (current(signal, id)) { state.rows = cloneFields(rows); state.baseline = JSON.stringify(state.rows); }
			} catch { if (current(signal, id)) state.error = '字段已保存，但重新加载失败。请重试加载确认服务器结果。'; }
		}, '字段保存失败，当前草稿已保留，可修正后重试。');
		return saved;
	}
	return { close, load, save };
}
