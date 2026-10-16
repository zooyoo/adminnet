export const widgetTitles = {
	welcome: '欢迎',
	myapp: '快捷入口',
	schedule: '我的日程',
	timer: '当前时钟',
	about: '关于项目',
	version: '版本信息',
	commit: '更新记录',
	echarts: '实时收入',
	progressing: '进度环',
};
export type WidgetKey = keyof typeof widgetTitles;
export interface WorkbenchLayout {
	columns: number[];
	widgets: WidgetKey[][];
}

export const layoutPresets = [
	{ columns: [12, 6, 6], label: '三列（12 / 6 / 6）' },
	{ columns: [24, 16, 8], label: '两行：通栏、双列（16 / 8）' },
	{ columns: [24], label: '单列通栏' },
	{ columns: [6, 12, 6], label: '三列（6 / 12 / 6）' },
	{ columns: [24, 6, 12, 6], label: '两行：通栏、三列（6 / 12 / 6）' },
	{ columns: [24, 6, 12, 6, 24], label: '三行：通栏、三列（6 / 12 / 6）、通栏' },
];

export function defaultLayout(): WorkbenchLayout {
	return {
		columns: [12, 6, 6],
		widgets: [
			['welcome', 'myapp', 'commit'],
			['about', 'version'],
			['timer', 'schedule'],
		],
	};
}

// 每个列宽对应一个独立容器，累计超过 24 列时才进入下一行。
export function layoutPositions(columns: readonly number[]) {
	let row = 1;
	let start = 1;
	return columns.map((span) => {
		if (start + span > 25) {
			row += 1;
			start = 1;
		}
		const position = { row, start, span };
		start += span;
		return position;
	});
}

export function parseLayout(raw: null | string): WorkbenchLayout {
	if (!raw) return defaultLayout();
	try {
		const value = JSON.parse(raw) as null | Partial<WorkbenchLayout>;
		if (
			!value ||
			!Array.isArray(value.columns) ||
			value.columns.length < 1 ||
			value.columns.length > 5 ||
			value.columns.some((width) => !Number.isInteger(width) || width < 1 || width > 24) ||
			!Array.isArray(value.widgets) ||
			value.widgets.length !== value.columns.length ||
			value.widgets.some((column) => !Array.isArray(column) || column.some((key) => typeof key !== 'string' || !Object.hasOwn(widgetTitles, key))) ||
			new Set(value.widgets.flat()).size !== value.widgets.flat().length
		)
			return defaultLayout();
		const positions = layoutPositions(value.columns);
		if (positions.some((position, index) => positions[index + 1]?.row !== position.row && position.start + position.span !== 25)) return defaultLayout();
		return { columns: [...value.columns], widgets: value.widgets.map((column) => [...column]) };
	} catch {
		return defaultLayout();
	}
}

// 扩容补空容器，缩容只将超出的容器按原顺序合并到末容器。
export function resizeLayout(layout: WorkbenchLayout, columns: readonly number[]): WorkbenchLayout {
	const widgets = Array.from({ length: columns.length }, (_, index) => [...(layout.widgets[index] ?? [])]);
	if (columns.length > 0 && columns.length < layout.widgets.length) widgets[columns.length - 1] = layout.widgets.slice(columns.length - 1).flat();
	return { columns: [...columns], widgets };
}

// 目标索引表示拖拽前的插入位置；同容器移除来源后需校正该位置。
export function moveWidget(layout: WorkbenchLayout, sourceColumn: number, sourceIndex: number, targetColumn: number, targetIndex: number): WorkbenchLayout {
	const result = { columns: [...layout.columns], widgets: layout.widgets.map((column) => [...column]) };
	const source = result.widgets[sourceColumn];
	const target = result.widgets[targetColumn];
	if (!source || !target || !Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex) || sourceIndex < 0 || sourceIndex >= source.length || targetIndex < 0 || targetIndex > target.length)
		return result;
	const [widget] = source.splice(sourceIndex, 1);
	const insertion = sourceColumn === targetColumn && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
	if (widget) target.splice(insertion, 0, widget);
	return result;
}

export function layoutKey(tenantId: unknown, userId: unknown) {
	return `adminnet:workbench:v1:${encodeURIComponent(String(tenantId))}:${encodeURIComponent(String(userId))}`;
}

export interface IncomeDemoSample {
	time: string;
	amount: number;
}

export const incomeDemoIntervalMs = 2100;

// 旧部件以 30 个零值、每点间隔 2 秒初始化；后续每 2.1 秒滚动一次。
export function createIncomeDemoSamples(now = new Date()): IncomeDemoSample[] {
	return Array.from({ length: 30 }, (_, index) => ({
		time: new Date(now.getTime() - (29 - index) * 2000).toLocaleTimeString().replace(/^\D*/, ''),
		amount: 0,
	}));
}

export function advanceIncomeDemoSamples(samples: readonly IncomeDemoSample[], now = new Date(), random = Math.random): IncomeDemoSample[] {
	return [...samples.slice(1), { time: now.toLocaleTimeString().replace(/^\D*/, ''), amount: Math.round(random() * 100) }];
}

export const scheduleTimeOptions = Array.from({ length: 96 }, (_, index) => {
	const hour = String(Math.floor(index / 4)).padStart(2, '0');
	const minute = String((index % 4) * 15).padStart(2, '0');
	const value = `${hour}:${minute}`;
	return { label: value, value };
});

// 旧 ChangeEndTime 的合同是开始时间加 1 小时，最晚为 23:45；15 分钟仅是下拉步长。
export function scheduleEndTime(startTime: string) {
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return '';
	const [hour, minute] = startTime.split(':').map(Number);
	const end = Math.min(hour! * 60 + minute! + 60, 23 * 60 + 45);
	return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

export function recentScheduleTimes(now = new Date()) {
	// 旧日程在 23 点统一使用 23:00 至 23:45，其余时刻取严格下一刻度。
	const start = now.getHours() === 23 ? 23 * 60 : (Math.floor((now.getHours() * 60 + now.getMinutes()) / 15) + 1) * 15;
	const startTime = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
	return { startTime, endTime: scheduleEndTime(startTime) };
}

const lunarDateFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric', timeZone: 'UTC' });
const lunarDayNames = [
	'初一',
	'初二',
	'初三',
	'初四',
	'初五',
	'初六',
	'初七',
	'初八',
	'初九',
	'初十',
	'十一',
	'十二',
	'十三',
	'十四',
	'十五',
	'十六',
	'十七',
	'十八',
	'十九',
	'二十',
	'廿一',
	'廿二',
	'廿三',
	'廿四',
	'廿五',
	'廿六',
	'廿七',
	'廿八',
	'廿九',
	'三十',
];

// 以日期本身而非浏览器时区换算，保留旧日历格的农历月和中文日。
export function scheduleLunarLabel(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
	const date = new Date(value + 'T12:00:00Z');
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return '';
	const parts = lunarDateFormatter.formatToParts(date);
	const month = parts
		.find((part) => part.type === 'month')
		?.value.replace('十一月', '冬月')
		.replace('十二月', '腊月');
	const day = lunarDayNames[Number(parts.find((part) => part.type === 'day')?.value) - 1];
	return month && day ? month + day : '';
}

export function sortSchedules<T extends { startTime: string }>(records: readonly T[]): T[] {
	return [...records].sort((left, right) => left.startTime.localeCompare(right.startTime));
}

export function scheduleValidation(value: { content: string; scheduleTime: string; startTime: string; endTime: string }) {
	if (!value.scheduleTime || !/^\d{4}-\d{2}-\d{2}$/.test(value.scheduleTime)) return '请选择日程日期';
	if (!value.content.trim() || value.content.trim().length > 256) return '日程内容须为 1 至 256 个字符';
	const time = /^([01]\d|2[0-3]):[0-5]\d$/;
	if (!time.test(value.startTime) || !time.test(value.endTime) || value.endTime <= value.startTime) return '结束时间须晚于开始时间';
	return '';
}
