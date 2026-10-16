import { flushPromises, mount } from '@vue/test-utils';

import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Schedule from './schedule.vue';
import { scheduleLunarLabel } from './workbench';

const { api, boundary } = vi.hoisted(() => ({
	api: { listSchedules: vi.fn(), saveSchedule: vi.fn(), deleteSchedule: vi.fn(), setScheduleStatus: vi.fn() },
	boundary: { version: 0, track: vi.fn(), release: vi.fn() },
}));
vi.mock('#/api/system/home', () => api);
vi.mock('#/api/session', () => ({ sessionBoundary: boundary }));
vi.mock('antdv-next', () => {
	const input = { props: ['value'], emits: ['update:value'], template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />' };
	return {
		Alert: { props: ['title'], template: '<p role="alert">{{ title }}</p>' },
		Button: { props: ['disabled', 'loading'], template: '<button :disabled="disabled || loading"><slot /></button>' },
		Calendar: { name: 'Calendar', props: ['value'], emits: ['select'], template: '<div><slot name="cellRender" :date="value" :info="{ type: \'date\' }" /></div>' },
		Form: { template: '<div><slot /></div>' },
		FormItem: { template: '<div><slot /></div>' },
		Input: Object.assign(input, { TextArea: input }),
		Modal: {
			props: ['open', 'title', 'okText', 'confirmLoading'],
			emits: ['ok', 'cancel'],
			template:
				'<section v-if="open" role="dialog" :aria-label="title"><slot /><button :disabled="confirmLoading" @click="$emit(\'ok\')">{{ okText || \'保存日程\' }}</button><button :disabled="confirmLoading" @click="$emit(\'cancel\')">取消</button></section>',
		},
		Select: {
			props: ['value', 'options'],
			emits: ['change'],
			template:
				'<select :value="value" @change="$emit(\'change\', $event.target.value)"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>',
		},
		Tag: { template: '<span><slot /></span>' },
	};
});
const record = { id: '46', scheduleTime: '2026-10-13T00:00:00', content: '旧日程内容', startTime: '09:00', endTime: '10:00', status: 0 };
const wrappers: ReturnType<typeof mount>[] = [];
function open() {
	const wrapper = mount(Schedule);
	wrappers.push(wrapper);
	return wrapper;
}
function button(wrapper: ReturnType<typeof mount>, text: string, selector = 'button') {
	const found = wrapper.findAll(selector).find((item) => item.text() === text);
	expect(found, text + '应可达').toBeDefined();
	return found!;
}
beforeEach(() => {
	boundary.version = 0;
	vi.clearAllMocks();
	api.listSchedules.mockReset().mockResolvedValue([record]);
	api.deleteSchedule.mockReset().mockResolvedValue(undefined);
	api.saveSchedule.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
	for (const wrapper of wrappers.splice(0)) wrapper.unmount();
	vi.useRealTimers();
});
describe('日程旧行为恢复', () => {
	it('整个 23 点新建日程使用 23:00 至 23:45', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		for (const minute of [0, 14, 29, 45, 59]) {
			vi.setSystemTime(new Date(2026, 9, 13, 23, minute));
			const wrapper = open();
			await flushPromises();
			await button(wrapper, '添加日程').trigger('click');
			expect(wrapper.get<HTMLInputElement>('[aria-label="开始时间"]').element.value).toBe('23:00');
			expect(wrapper.get<HTMLInputElement>('[aria-label="结束时间"]').element.value).toBe('23:45');
			wrapper.unmount();
		}
	});
	it('农历提供月及中文日，跨月和无效日期不会错位', () => {
		expect(scheduleLunarLabel('2026-09-28')).toBe('八月十八');
		expect(scheduleLunarLabel('2026-10-01')).toBe('八月廿一');
		expect(scheduleLunarLabel('2026-10-13')).toBe('九月初四');
		expect(scheduleLunarLabel('2026-02-30')).toBe('');
		expect(scheduleLunarLabel('')).toBe('');
		expect(scheduleLunarLabel('2026-12-20')).toBe('冬月十二');
		expect(scheduleLunarLabel('2027-01-20')).toBe('腊月十三');
		expect(scheduleLunarLabel('2025-08-01')).toBe('闰六月初八');
	});
	it('组件每格渲染农历', async () => {
		const wrapper = open();
		await flushPromises();
		expect(wrapper.get('.schedule-lunar').text()).toBe(scheduleLunarLabel(dayjs().format('YYYY-MM-DD')));
	});
	it('同月另一日及已选同日每次点击都重新查询', async () => {
		const wrapper = open();
		await flushPromises();
		const calendar = wrapper.findComponent({ name: 'Calendar' });
		for (const selected of ['2026-10-01', '2026-10-01']) {
			const count = api.listSchedules.mock.calls.length;
			calendar.vm.$emit('select', dayjs(selected), { source: 'date' });
			await flushPromises();
			expect(api.listSchedules).toHaveBeenCalledTimes(count + 1);
		}
	});
	it('编辑内删除取消保留草稿，确认成功才关闭两个弹窗', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 13, 9));
		const wrapper = open();
		await flushPromises();
		await button(wrapper, '编辑日程').trigger('click');
		await wrapper.get('[aria-label="日程内容"]').setValue('尚未保存的草稿');
		await button(wrapper, '删除日程', '[aria-label="编辑日程"] button').trigger('click');
		await button(wrapper, '取消', '[aria-label="确认删除日程"] button').trigger('click');
		expect(api.deleteSchedule).not.toHaveBeenCalled();
		expect(wrapper.get<HTMLInputElement>('input[aria-label="日程内容"]').element.value).toBe('尚未保存的草稿');
		await button(wrapper, '删除日程', '[aria-label="编辑日程"] button').trigger('click');
		await button(wrapper, '删除', '[aria-label="确认删除日程"] button').trigger('click');
		await flushPromises();
		expect(api.deleteSchedule).toHaveBeenCalledExactlyOnceWith('46', expect.any(AbortSignal));
		expect(wrapper.findAll('[role="dialog"]')).toHaveLength(0);
	});
	it('编辑内删除被拒保留两弹窗、内容和重试能力', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 13, 9));
		api.deleteSchedule.mockRejectedValueOnce(new Error('删除被拒绝'));
		const wrapper = open();
		await flushPromises();
		await button(wrapper, '编辑日程').trigger('click');
		await button(wrapper, '删除日程', '[aria-label="编辑日程"] button').trigger('click');
		await button(wrapper, '删除', '[aria-label="确认删除日程"] button').trigger('click');
		await flushPromises();
		expect(wrapper.findAll('[role="dialog"]')).toHaveLength(2);
		expect(wrapper.text()).toContain('删除被拒绝');
		expect(wrapper.get<HTMLInputElement>('[aria-label="日程内容"]').element.value).toBe(record.content);
		await button(wrapper, '删除', '[aria-label="确认删除日程"] button').trigger('click');
		await flushPromises();
		expect(api.deleteSchedule).toHaveBeenCalledTimes(2);
		expect(wrapper.findAll('[role="dialog"]')).toHaveLength(0);
	});
});
