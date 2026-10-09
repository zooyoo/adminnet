import { effectScope } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWatermark } from './use-watermark';

const state = vi.hoisted(() => ({
	instances: [] as Array<{ content: string; destroyed: boolean }>,
	wait: undefined as Promise<void> | undefined,
}));
vi.mock('watermark-js-plus', () => ({
	Watermark: class {
		content: string;
		destroyed = false;
		constructor(options: { content: string }) { this.content = options.content; state.instances.push(this); }
		async changeOptions(options: { content: string }) { this.content = options.content; await state.wait; }
		async create() { await state.wait; }
		destroy() { this.destroyed = true; }
	},
}));

beforeEach(() => { state.instances = []; state.wait = undefined; });

describe('水印会话生命周期', () => {
	it('每次布局卸载均销毁自己的水印，不复用旧账号文字', async () => {
		const firstScope = effectScope();
		const first = firstScope.run(useWatermark)!;
		await first.updateWatermark({ content: 'first-user' });
		firstScope.stop();
		expect(state.instances[0]?.destroyed).toBe(true);
		const secondScope = effectScope();
		const second = secondScope.run(useWatermark)!;
		await second.updateWatermark({ content: 'second-user' });
		expect(state.instances[1]?.content).toBe('second-user');
		secondScope.stop();
		expect(state.instances[1]?.destroyed).toBe(true);
	});

	it('退出后迟到的创建会被销毁，不能恢复旧水印', async () => {
		let release!: () => void;
		state.wait = new Promise<void>((resolve) => { release = resolve; });
		const scope = effectScope();
		const api = scope.run(useWatermark)!;
		const pending = api.updateWatermark({ content: 'old-user' });
		await vi.waitFor(() => expect(state.instances).toHaveLength(1));
		scope.stop();
		release();
		await pending;
		expect(state.instances[0]?.destroyed).toBe(true);
		expect(api.watermark.value).toBeUndefined();
	});

	it('连续更新只保留当前内容，旧创建完成后不影响新水印', async () => {
		let release!: () => void;
		state.wait = new Promise<void>((resolve) => { release = resolve; });
		const scope = effectScope();
		const api = scope.run(useWatermark)!;
		const old = api.updateWatermark({ content: 'old-user' });
		await vi.waitFor(() => expect(state.instances).toHaveLength(1));
		const next = api.updateWatermark({ content: 'new-user' });
		release();
		await Promise.all([old, next]);
		expect(state.instances[0]?.destroyed).toBe(true);
		expect(state.instances[1]?.content).toBe('new-user');
		expect(state.instances[1]?.destroyed).toBe(false);
		scope.stop();
	});
});
