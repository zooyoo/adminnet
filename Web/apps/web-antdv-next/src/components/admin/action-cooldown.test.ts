import { effectScope } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { useActionCooldown } from './action-cooldown';
afterEach(() => vi.useRealTimers());
describe('用户动作冷却与会话寿命', () => {
	it('已完成网络请求不解除3秒输入锁，实体和种子各自计时', () => {
		vi.useFakeTimers();
		const scope = effectScope();
		const state = scope.run(() => useActionCooldown<'entity' | 'seed'>(3000))!;
		expect(state.begin('entity')).toBe(true);
		expect(state.begin('entity')).toBe(false);
		expect(state.begin('seed')).toBe(true);
		vi.advanceTimersByTime(2999);
		expect(state.begin('entity')).toBe(false);
		vi.advanceTimersByTime(1);
		expect(state.begin('entity')).toBe(true);
		scope.stop();
		expect(vi.getTimerCount()).toBe(0);
	});
	it('5秒锁在身份失效清理后允许新会话动作且旧timer不能回写新锁', () => {
		vi.useFakeTimers();
		const scope = effectScope();
		const state = scope.run(() => useActionCooldown<'clear' | 'webHookKey'>(5000))!;
		state.begin('clear');
		vi.advanceTimersByTime(1000);
		state.clear();
		expect(state.active.value).toEqual([]);
		state.begin('clear');
		vi.advanceTimersByTime(4000);
		expect(state.active.value).toEqual(['clear']);
		vi.advanceTimersByTime(1000);
		expect(state.active.value).toEqual([]);
		scope.stop();
	});
	it('离页scope stop撤销全部待定timer', () => {
		vi.useFakeTimers();
		const scope = effectScope();
		const state = scope.run(() => useActionCooldown<'restore' | 'update'>(5000))!;
		state.begin('update');
		state.begin('restore');
		scope.stop();
		expect(vi.getTimerCount()).toBe(0);
		expect(state.active.value).toEqual([]);
		vi.advanceTimersByTime(5001);
		expect(state.active.value).toEqual([]);
	});
});
