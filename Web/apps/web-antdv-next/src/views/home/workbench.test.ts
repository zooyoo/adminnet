import { describe, expect, it } from 'vitest';

import { defaultLayout, layoutKey, parseLayout, scheduleValidation } from './workbench';

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
