import type { WidgetKey, WorkbenchLayout } from './workbench';

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';

import { Progress } from 'antdv-next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IncomeDemo from './income-demo.vue';
import ProgressDemo from './progress-demo.vue';
import Schedule from './schedule.vue';
import {
	advanceIncomeDemoSamples,
	createIncomeDemoSamples,
	defaultLayout,
	incomeDemoIntervalMs,
	layoutKey,
	layoutPositions,
	layoutPresets,
	moveWidget,
	parseLayout,
	recentScheduleTimes,
	resizeLayout,
	scheduleEndTime,
	scheduleTimeOptions,
	scheduleValidation,
	sortSchedules,
} from './workbench';
import HomeWorkbench from './workbench-content.vue';

type DemoChartMock = { dispose: ReturnType<typeof vi.fn>; isDisposed: () => boolean; setOption: ReturnType<typeof vi.fn> };
const { chartHandles, listSchedules, renderChart, saveSchedule } = vi.hoisted(() => ({
	chartHandles: [] as DemoChartMock[],
	listSchedules: vi.fn(),
	renderChart: vi.fn(),
	saveSchedule: vi.fn(),
}));
vi.mock('#/api/system/home', () => ({
	listSchedules,
	saveSchedule,
	deleteSchedule: vi.fn(),
	setScheduleStatus: vi.fn(),
	getAvailableMenus: vi.fn().mockResolvedValue([]),
	getFavoriteMenus: vi.fn().mockResolvedValue([]),
	saveFavoriteMenus: vi.fn(),
}));
vi.mock('#/api/session', () => ({ sessionBoundary: { version: 0, track: vi.fn(), release: vi.fn() } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@vben/preferences', () => ({ preferences: { app: { name: 'Admin.NET' } } }));
vi.mock('@vben/stores', () => ({ useUserStore: () => ({ userInfo: { userId: 'widget-user', currentTenantId: 'widget-tenant' } }) }));
vi.mock('@vben/plugins/echarts', async () => {
	const { ref: vueRef } = await import('vue');
	return {
		EchartsUI: { template: '<div />' },
		useEcharts: () => {
			let chart: DemoChartMock | undefined;
			return {
				isActive: vueRef(false),
				getChartInstance: () => chart,
				renderEcharts: async (options: unknown) => {
					await renderChart(options);
					let disposed = false;
					chart = {
						dispose: vi.fn(() => {
							disposed = true;
						}),
						isDisposed: () => disposed,
						setOption: vi.fn(),
					};
					chartHandles.push(chart);
					return chart;
				},
			};
		},
	};
});
vi.mock('antdv-next', () => {
	const Input = { props: ['value'], emits: ['update:value'], template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />' };
	return {
		Alert: { props: ['title'], template: '<p role="alert">{{ title }}</p>' },
		Button: { template: '<button><slot /></button>' },
		Calendar: { template: '<div />' },
		Card: { props: ['title'], template: '<article><h3>{{ title }}</h3><slot /></article>' },
		CheckboxGroup: { template: '<div />' },
		Progress: { props: ['type', 'percent', 'size'], template: '<span>{{ percent }}%</span>' },
		Form: { template: '<div><slot /></div>' },
		FormItem: { template: '<div><slot /></div>' },
		Input: Object.assign(Input, { TextArea: Input }),
		Modal: {
			props: ['open', 'okText'],
			emits: ['ok', 'cancel'],
			template: '<section v-if="open" role="dialog"><slot /><button @click="$emit(\'ok\')">{{ okText || "保存日程" }}</button><button @click="$emit(\'cancel\')">取消</button></section>',
		},
		Select: {
			props: ['value', 'options'],
			emits: ['change'],
			template:
				'<select :value="value" @change="$emit(\'change\', $event.target.value)"><option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">{{ option.label }}</option></select>',
		},
		Tag: { template: '<span><slot /></span>' },
	};
});
enableAutoUnmount(afterEach);

// 仅组件契约测试的公开请求边界，禁止回归测试访问真实互联网。
beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] })));
afterEach(() => vi.unstubAllGlobals());

describe('工作台持久化边界', () => {
	it('拒绝损坏配置、重复组件和无效列宽，恢复可用默认布局', () => {
		for (const raw of ['{', '{}', '{"columns":[24],"widgets":[["schedule","schedule"]]}', '{"columns":[24],"widgets":[["fake-revenue"]]}', '{"columns":[12],"widgets":[[]]}']) {
			expect(parseLayout(raw)).toEqual(defaultLayout());
		}
	});
	it('保留用户隐藏全部组件与调整顺序的配置', () => {
		const empty = { columns: [24], widgets: [[]] };
		const ordered = { columns: [6, 12, 6], widgets: [['timer'], ['schedule', 'welcome'], []] };
		expect(parseLayout(JSON.stringify(empty))).toEqual(empty);
		expect(parseLayout(JSON.stringify(ordered))).toEqual(ordered);
	});
	it('不同账号和租户不能共享配置键', () => {
		expect(new Set([layoutKey(1, 1), layoutKey(1, 2), layoutKey(2, 1)]).size).toBe(3);
	});
});
describe('日程输入', () => {
	it('拒绝空白内容、无效日期格式和逆序时间', () => {
		const valid = { scheduleTime: '2026-10-09', content: '会议', startTime: '09:00', endTime: '10:00' };
		expect(scheduleValidation(valid)).toBe('');
		for (const changes of [{ content: ' ' }, { content: '长'.repeat(257) }, { scheduleTime: '' }, { startTime: '25:00' }, { endTime: '08:00' }]) {
			expect(scheduleValidation({ ...valid, ...changes })).not.toBe('');
		}
	});
});

describe('旧工作台容器与 24 列行合同', () => {
	it('提供源码中的六个布局，并恢复原默认部件容器', () => {
		expect(layoutPresets.map((item) => item.columns)).toEqual([[12, 6, 6], [24, 16, 8], [24], [6, 12, 6], [24, 6, 12, 6], [24, 6, 12, 6, 24]]);
		expect(defaultLayout()).toEqual({
			columns: [12, 6, 6],
			widgets: [
				['welcome', 'myapp', 'commit'],
				['about', 'version'],
				['timer', 'schedule'],
			],
		});
	});
	it.each([
		{ columns: [12, 6, 6], rows: [1, 1, 1], starts: [1, 13, 19] },
		{ columns: [24, 16, 8], rows: [1, 2, 2], starts: [1, 1, 17] },
		{ columns: [24], rows: [1], starts: [1] },
		{ columns: [6, 12, 6], rows: [1, 1, 1], starts: [1, 7, 19] },
		{ columns: [24, 6, 12, 6], rows: [1, 2, 2, 2], starts: [1, 1, 7, 19] },
		{ columns: [24, 6, 12, 6, 24], rows: [1, 2, 2, 2, 3], starts: [1, 1, 7, 19, 1] },
	])('布局 $columns 保留独立容器和实际行', ({ columns, rows, starts }) => {
		const positions = layoutPositions(columns);
		expect(positions.map((item) => item.row)).toEqual(rows);
		expect(positions.map((item) => item.start)).toEqual(starts);
		expect(positions.map((item) => item.span)).toEqual(columns);
		const keys: WidgetKey[] = ['welcome', 'schedule', 'timer', 'about', 'version'];
		const layout: WorkbenchLayout = { columns, widgets: columns.map((_, index) => [keys[index]!]) };
		expect(parseLayout(JSON.stringify(layout))).toEqual(layout);
	});
	it('保留三行中的空容器、隐藏部件和已有双列配置', () => {
		const layout = { columns: [24, 6, 12, 6, 24], widgets: [['schedule', 'welcome'], [], ['timer'], [], []] };
		const previous = { columns: [12, 12], widgets: [['myapp'], []] };
		expect(parseLayout(JSON.stringify(layout))).toEqual(layout);
		expect(parseLayout(JSON.stringify(previous))).toEqual(previous);
	});
	it('拒绝非法列宽、未满 24 的行、容器数不匹配及旧全局配置格式', () => {
		for (const raw of [
			'null',
			'{"columns":[0,24],"widgets":[[],[]]}',
			'{"columns":[25],"widgets":[[]]}',
			'{"columns":[12.5,11.5],"widgets":[[],[]]}',
			'{"columns":[24,12],"widgets":[[],[]]}',
			'{"columns":[16,16,8],"widgets":[[],[],[]]}',
			'{"columns":[24,16,8],"widgets":[[]]}',
			'{"columns":[24],"widgets":[null]}',
			'{"layout":[12,6,6],"copmsList":[["welcome"],[],[]]}',
		])
			expect(parseLayout(raw)).toEqual(defaultLayout());
	});
	it('扩容只追加空容器，缩容按原容器顺序合并到末容器', () => {
		const layout: WorkbenchLayout = { columns: [24, 16, 8], widgets: [['timer', 'welcome'], [], ['schedule']] };
		expect(resizeLayout(layout, [24, 6, 12, 6, 24])).toEqual({ columns: [24, 6, 12, 6, 24], widgets: [['timer', 'welcome'], [], ['schedule'], [], []] });
		const expanded: WorkbenchLayout = { columns: [24, 6, 12, 6, 24], widgets: [['welcome'], ['myapp'], [], ['timer', 'version'], ['schedule', 'about']] };
		expect(resizeLayout(expanded, [12, 12])).toEqual({ columns: [12, 12], widgets: [['welcome'], ['myapp', 'timer', 'version', 'schedule', 'about']] });
		expect(resizeLayout(expanded, [24])).toEqual({ columns: [24], widgets: [['welcome', 'myapp', 'timer', 'version', 'schedule', 'about']] });
		expect(expanded.widgets).toEqual([['welcome'], ['myapp'], [], ['timer', 'version'], ['schedule', 'about']]);
	});
});
describe('拖拽顺序与身份命名空间', () => {
	const layout: WorkbenchLayout = { columns: [12, 6, 6], widgets: [['welcome', 'myapp', 'commit'], [], ['timer', 'schedule']] };
	it('同容器向后拖到末尾，或向前拖到首位', () => {
		expect(moveWidget(layout, 0, 0, 0, 3).widgets[0]).toEqual(['myapp', 'commit', 'welcome']);
		expect(moveWidget(layout, 0, 2, 0, 0).widgets[0]).toEqual(['commit', 'welcome', 'myapp']);
		expect(moveWidget(layout, 0, 1, 0, 2)).toEqual(layout);
	});
	it('跨容器拖到指定部件前或空容器，保留其他容器和原数据', () => {
		expect(moveWidget(layout, 0, 1, 2, 1).widgets).toEqual([['welcome', 'commit'], [], ['timer', 'myapp', 'schedule']]);
		expect(moveWidget(layout, 0, 0, 1, 0).widgets).toEqual([['myapp', 'commit'], ['welcome'], ['timer', 'schedule']]);
		expect(layout.widgets).toEqual([['welcome', 'myapp', 'commit'], [], ['timer', 'schedule']]);
	});
	it('忽略过期或越界的来源与目标，不丢失部件', () => {
		for (const [column, index, target, insertion] of [
			[0, 10, 1, 0],
			[-1, 0, 1, 0],
			[0, 0, 10, 0],
			[0, 0, 1, -1],
			[0, 0, 1, 1],
		]) {
			expect(moveWidget(layout, column!, index!, target!, insertion!)).toEqual(layout);
		}
	});
	it('保留 v1 数字键并避免账号、租户及分隔符组合碰撞', () => {
		expect(layoutKey(1, 1)).toBe('adminnet:workbench:v1:1:1');
		expect(new Set([layoutKey(1, 1), layoutKey(1, 2), layoutKey(2, 1), layoutKey('a', 'b:c'), layoutKey('a:b', 'c')]).size).toBe(5);
	});
});
describe('日程时刻与真实 StartTime 顺序', () => {
	it('下拉从 00:00 到 23:45，每隔 15 分钟，包含 96 个时刻', () => {
		expect(scheduleTimeOptions).toHaveLength(96);
		expect(scheduleTimeOptions.slice(0, 4)).toEqual([
			{ label: '00:00', value: '00:00' },
			{ label: '00:15', value: '00:15' },
			{ label: '00:30', value: '00:30' },
			{ label: '00:45', value: '00:45' },
		]);
		expect(scheduleTimeOptions.at(-1)).toEqual({ label: '23:45', value: '23:45' });
		expect(new Set(scheduleTimeOptions.map((item) => item.value)).size).toBe(96);
	});
	it.each([
		['00:00', '01:00'],
		['09:00', '10:00'],
		['09:45', '10:45'],
		['22:30', '23:30'],
		['22:45', '23:45'],
		['23:00', '23:45'],
		['23:15', '23:45'],
		['23:30', '23:45'],
		['23:45', '23:45'],
	])('开始 %s 按旧 ChangeEndTime 加 60 分钟并钳到 %s', (start, end) => {
		expect(scheduleEndTime(start!)).toBe(end);
	});
	it('清空或非法开始不产生结束时间，23:45 同起止不能提交', () => {
		for (const value of ['', '9:00', '24:00', '23:60']) expect(scheduleEndTime(value)).toBe('');
		expect(scheduleValidation({ scheduleTime: '2026-10-13', content: '末刻边界', startTime: '23:45', endTime: scheduleEndTime('23:45') })).toBe('结束时间须晚于开始时间');
	});
	it('仅按 StartTime 升序、同起始保持原顺序，既不要求 orderNo 也不修改原数组', () => {
		const records = Object.freeze([
			{ id: 2, startTime: '09:45' },
			{ id: 3, startTime: '08:30' },
			{ id: 1, startTime: '09:45' },
		]);
		expect(sortSchedules(records).map((item) => item.id)).toEqual([3, 2, 1]);
		expect(records.map((item) => item.id)).toEqual([2, 3, 1]);
	});
});

describe('新建日程的本地默认时刻', () => {
	it.each([
		[9, 0, '09:15', '10:15'],
		[9, 14, '09:15', '10:15'],
		[9, 15, '09:30', '10:30'],
		[9, 30, '09:45', '10:45'],
		[9, 45, '10:00', '11:00'],
		[22, 44, '22:45', '23:45'],
		[22, 45, '23:00', '23:45'],
		[22, 59, '23:00', '23:45'],
		[23, 0, '23:00', '23:45'],
		[23, 15, '23:00', '23:45'],
		[23, 29, '23:00', '23:45'],
		[23, 30, '23:00', '23:45'],
		[23, 45, '23:00', '23:45'],
		[23, 59, '23:00', '23:45'],
	])('本地 %i:%i 新建为 %s 至 %s，保留旧晚间区间及有效起止', (hour, minute, startTime, endTime) => {
		expect(recentScheduleTimes(new Date(2026, 9, 13, Number(hour), Number(minute), 59))).toEqual({ startTime, endTime });
	});
	it('全天每分钟的新建默认都属于下拉刻度且起止有效', () => {
		const options = new Set(scheduleTimeOptions.map((option) => option.value));
		for (let minute = 0; minute < 24 * 60; minute += 1) {
			const times = recentScheduleTimes(new Date(2026, 9, 13, 0, minute));
			expect(options.has(times.startTime) && options.has(times.endTime)).toBe(true);
			expect(times.startTime < times.endTime && times.endTime <= '23:45').toBe(true);
		}
	});
});

describe('日程编辑回填、选择联动与错误草稿', () => {
	const record = { id: '46', scheduleTime: '2026-10-13T00:00:00', content: '保留服务端草稿', startTime: '09:00', endTime: '10:30', status: 0 };
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 13, 9, 0));
		listSchedules.mockReset().mockResolvedValue([record]);
		saveSchedule.mockReset().mockResolvedValue(undefined);
	});
	afterEach(() => vi.useRealTimers());
	it('已有记录 hydration 保留结束时间，只有用户开始选择才按旧合同联动', async () => {
		const wrapper = mount(Schedule);
		await flushPromises();
		await wrapper.get('.schedule-list button').trigger('click');
		const start = wrapper.get<HTMLSelectElement>('[aria-label="开始时间"]');
		const end = wrapper.get<HTMLSelectElement>('[aria-label="结束时间"]');
		expect(start.element.value).toBe('09:00');
		expect(end.element.value).toBe('10:30');
		await start.setValue('09:45');
		expect(end.element.value).toBe('10:45');
		await end.setValue('10:00');
		expect(end.element.value).toBe('10:00');
		await start.setValue('23:00');
		expect(end.element.value).toBe('23:45');
		expect(start.get<HTMLOptionElement>('option[value="23:45"]').element.disabled).toBe(false);
		expect(record.endTime).toBe('10:30');
		expect(saveSchedule).not.toHaveBeenCalled();
	});
	it('每次新建按弹窗打开时的本地当前时间计算，23 点末尾仍给出有效默认', async () => {
		const wrapper = mount(Schedule);
		await flushPromises();
		vi.setSystemTime(new Date(2026, 9, 13, 9, 45));
		await wrapper.get('.schedule-toolbar button').trigger('click');
		expect(wrapper.get<HTMLSelectElement>('[aria-label="开始时间"]').element.value).toBe('10:00');
		expect(wrapper.get<HTMLSelectElement>('[aria-label="结束时间"]').element.value).toBe('11:00');
		await wrapper.get('[role="dialog"] button:last-child').trigger('click');
		vi.setSystemTime(new Date(2026, 9, 13, 23, 59));
		await wrapper.get('.schedule-toolbar button').trigger('click');
		expect(wrapper.get<HTMLSelectElement>('[aria-label="开始时间"]').element.value).toBe('23:00');
		expect(wrapper.get<HTMLSelectElement>('[aria-label="结束时间"]').element.value).toBe('23:45');
		expect(wrapper.get<HTMLInputElement>('[aria-label="日程日期"]').element.value).toBe('2026-10-13');
	});
	it('服务拒绝后保留错误草稿，手动 23:45 同起止也保留以供修正', async () => {
		saveSchedule.mockRejectedValue(new Error('服务端时间范围无效'));
		const wrapper = mount(Schedule);
		await flushPromises();
		await wrapper.get('.schedule-list button').trigger('click');
		const start = wrapper.get<HTMLSelectElement>('[aria-label="开始时间"]');
		await start.setValue('23:30');
		await wrapper
			.findAll('[role="dialog"] button')
			.find((button) => button.text() === '保存日程')!
			.trigger('click');
		await flushPromises();
		expect(saveSchedule).toHaveBeenCalledTimes(1);
		expect(saveSchedule.mock.calls[0]![0]).toMatchObject({ id: '46', content: record.content, startTime: '23:30', endTime: '23:45' });
		expect(wrapper.get('[role="dialog"]').text()).toContain('服务端时间范围无效');
		expect(start.element.value).toBe('23:30');
		expect(wrapper.get<HTMLInputElement>('[aria-label="日程内容"]').element.value).toBe(record.content);
		await start.setValue('23:45');
		await wrapper
			.findAll('[role="dialog"] button')
			.find((button) => button.text() === '保存日程')!
			.trigger('click');
		expect(wrapper.get('[role="dialog"]').text()).toContain('结束时间须晚于开始时间');
		expect(start.element.value).toBe('23:45');
		expect(wrapper.get<HTMLSelectElement>('[aria-label="结束时间"]').element.value).toBe('23:45');
		expect(saveSchedule).toHaveBeenCalledTimes(1);
	});
});

describe('旧演示部件的数据与持久化合同', () => {
	it('保留收入和进度环的存量配置及顺序，默认七部件不增加演示数据', () => {
		const saved = { columns: [12, 12], widgets: [['echarts', 'welcome'], ['progressing']] };
		expect(parseLayout(JSON.stringify(saved))).toEqual(saved);
		expect(defaultLayout().widgets.flat()).not.toContain('echarts');
		expect(defaultLayout().widgets.flat()).not.toContain('progressing');
	});
	it('从三十个零值初始化，跨午夜滚动保留窗口与 0 至 100 的旧随机演示值', () => {
		const now = new Date(2026, 9, 13, 0, 0, 0);
		const initial = createIncomeDemoSamples(now);
		expect(initial).toHaveLength(30);
		expect(initial.every((item) => item.amount === 0)).toBe(true);
		expect(initial[0]?.time).toBe(new Date(2026, 9, 12, 23, 59, 2).toLocaleTimeString().replace(/^\D*/, ''));
		expect(initial.at(-1)?.time).toBe(now.toLocaleTimeString().replace(/^\D*/, ''));
		const next = new Date(now.getTime() + incomeDemoIntervalMs);
		for (const [random, amount] of [
			[0, 0],
			[0.5, 50],
			[0.999, 100],
		]) {
			const updated = advanceIncomeDemoSamples(initial, next, () => random!);
			expect(updated).toHaveLength(30);
			expect(updated.slice(0, -1)).toEqual(initial.slice(1));
			expect(updated.at(-1)).toEqual({ time: next.toLocaleTimeString().replace(/^\D*/, ''), amount });
		}
		expect(initial.every((item) => item.amount === 0)).toBe(true);
	});
	it('以 99.9% dashboard 展示固定演示进度，并保留可读说明', () => {
		const wrapper = mount(ProgressDemo);
		expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('项目进度演示：99.9%');
		expect(wrapper.text()).toContain('99.9%');
		expect(wrapper.text()).toContain('项目进度演示，固定为 99.9%');
		expect(wrapper.findComponent(Progress).props()).toMatchObject({ type: 'dashboard', percent: 99.9, size: 160 });
	});
});

describe('收入演示生命周期', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 9, 13, 9, 0));
		renderChart.mockReset().mockResolvedValue(undefined);
		chartHandles.length = 0;
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});
	it.each(['abort', 'unmount'])('每 2100 ms 更新，%s 后停止刷新并销毁图表', async (reason) => {
		const controller = new AbortController();
		const wrapper = mount(IncomeDemo, { props: { signal: controller.signal } });
		await flushPromises();
		const chart = chartHandles[0]!;
		expect(wrapper.get('summary').text()).toContain('30 个点');
		expect(wrapper.findAll('tbody tr')).toHaveLength(30);
		await vi.advanceTimersByTimeAsync(2099);
		expect(chart.setOption).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(chart.setOption).toHaveBeenCalledTimes(1);
		if (reason === 'abort') {
			controller.abort();
			await nextTick();
			expect(wrapper.find('[data-testid="income-demo-chart"]').exists()).toBe(false);
		} else wrapper.unmount();
		expect(chart.dispose).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(4200);
		expect(chart.setOption).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});
	it('会话取消发生在图表初始化完成前时，不启动计时器并回收晚到实例', async () => {
		let finish = () => {};
		renderChart.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		const controller = new AbortController();
		const wrapper = mount(IncomeDemo, { props: { signal: controller.signal } });
		controller.abort();
		finish();
		await flushPromises();
		expect(chartHandles[0]?.dispose).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		wrapper.unmount();
	});
	it('KeepAlive 离开时回收图表，返回时只启动一个新的刷新周期', async () => {
		const visible = ref(true);
		const controller = new AbortController();
		const Host = defineComponent({ setup: () => () => h(KeepAlive, () => (visible.value ? h(IncomeDemo, { signal: controller.signal }) : null)) });
		const wrapper = mount(Host);
		await flushPromises();
		expect(renderChart).toHaveBeenCalledTimes(1);
		visible.value = false;
		await nextTick();
		expect(chartHandles[0]?.dispose).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		visible.value = true;
		await nextTick();
		await flushPromises();
		expect(renderChart).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(2100);
		expect(chartHandles[0]?.setOption).not.toHaveBeenCalled();
		expect(chartHandles[1]?.setOption).toHaveBeenCalledTimes(1);
		wrapper.unmount();
		expect(chartHandles[1]?.dispose).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('工作台遗漏部件选择、重载与即时恢复默认', () => {
	const storageKey = layoutKey('widget-tenant', 'widget-user');
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		listSchedules.mockReset().mockResolvedValue([]);
		renderChart.mockReset().mockResolvedValue(undefined);
		chartHandles.length = 0;
	});
	afterEach(() => {
		localStorage.clear();
		vi.clearAllTimers();
		vi.useRealTimers();
	});
	it('两个部件可选择、保存，并在当前身份重新打开后渲染', async () => {
		localStorage.setItem(storageKey, JSON.stringify({ columns: [24], widgets: [[]] }));
		const wrapper = mount(HomeWorkbench);
		await flushPromises();
		await wrapper
			.findAll('button')
			.find((button) => button.text() === '自定义工作台')!
			.trigger('click');
		await wrapper
			.findAll('button')
			.find((button) => button.text() === '添加实时收入')!
			.trigger('click');
		await wrapper
			.findAll('button')
			.find((button) => button.text() === '添加进度环')!
			.trigger('click');
		await wrapper
			.findAll('button')
			.find((button) => button.text() === '保存布局')!
			.trigger('click');
		await flushPromises();
		expect(wrapper.findAll('[data-widget]').map((item) => item.attributes('data-widget'))).toEqual(['echarts', 'progressing']);
		expect(wrapper.findComponent(IncomeDemo).exists()).toBe(true);
		expect(wrapper.findComponent(ProgressDemo).exists()).toBe(true);
		expect(parseLayout(localStorage.getItem(storageKey))).toEqual({ columns: [24], widgets: [['echarts', 'progressing']] });
		wrapper.unmount();
		const reopened = mount(HomeWorkbench);
		await flushPromises();
		expect(reopened.findComponent(IncomeDemo).exists() && reopened.findComponent(ProgressDemo).exists()).toBe(true);
		reopened.unmount();
	});
	it('恢复默认立即退出并清除当前身份保存项，其他身份布局保持原值', async () => {
		const otherKey = layoutKey('other-tenant', 'widget-user');
		localStorage.setItem(storageKey, JSON.stringify({ columns: [24], widgets: [['echarts', 'progressing']] }));
		localStorage.setItem(otherKey, 'other-layout');
		const wrapper = mount(HomeWorkbench);
		await flushPromises();
		await wrapper
			.findAll('button')
			.find((button) => button.text() === '自定义工作台')!
			.trigger('click');
		await wrapper
			.findAll('button')
			.find((button) => button.text() === '恢复默认布局')!
			.trigger('click');
		await flushPromises();
		expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
		expect(wrapper.findAll('[data-widget]').map((item) => item.attributes('data-widget'))).toEqual(defaultLayout().widgets.flat());
		expect(localStorage.getItem(storageKey)).toBeNull();
		expect(localStorage.getItem(otherKey)).toBe('other-layout');
		expect(chartHandles[0]?.dispose).toHaveBeenCalledTimes(1);
		wrapper.unmount();
		const reopened = mount(HomeWorkbench);
		await flushPromises();
		expect(reopened.findAll('[data-widget]').map((item) => item.attributes('data-widget'))).toEqual(defaultLayout().widgets.flat());
		reopened.unmount();
	});
});
