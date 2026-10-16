export const widgetTitles = {
	welcome: '欢迎',
	myapp: '快捷入口',
	schedule: '我的日程',
	timer: '当前时钟',
	about: '关于项目',
	version: '版本信息',
	commit: '更新记录',
};
export type WidgetKey = keyof typeof widgetTitles;
export interface WorkbenchLayout {
	columns: number[];
	widgets: WidgetKey[][];
}

export function defaultLayout(): WorkbenchLayout {
	return {
		columns: [12, 12],
		widgets: [
			['welcome', 'myapp', 'about', 'version', 'commit'],
			['schedule', 'timer'],
		],
	};
}

export function parseLayout(raw: null | string): WorkbenchLayout {
	if (!raw) return defaultLayout();
	try {
		const value = JSON.parse(raw) as WorkbenchLayout;
		if (
			!Array.isArray(value.columns) ||
			value.columns.length < 1 ||
			value.columns.length > 3 ||
			value.columns.some((width) => !Number.isInteger(width) || width < 1) ||
			value.columns.reduce((sum, width) => sum + width, 0) !== 24 ||
			!Array.isArray(value.widgets) ||
			value.widgets.length !== value.columns.length ||
			value.widgets.some((column) => !Array.isArray(column) || column.some((key) => !Object.hasOwn(widgetTitles, key))) ||
			new Set(value.widgets.flat()).size !== value.widgets.flat().length
		)
			return defaultLayout();
		return value;
	} catch {
		return defaultLayout();
	}
}

export function layoutKey(tenantId: unknown, userId: unknown) {
	return `adminnet:workbench:v1:${String(tenantId)}:${String(userId)}`;
}

export function scheduleValidation(value: { content: string; scheduleTime: string; startTime: string; endTime: string }) {
	if (!value.scheduleTime || !/^\d{4}-\d{2}-\d{2}$/.test(value.scheduleTime)) return '请选择日程日期';
	if (!value.content.trim() || value.content.trim().length > 256) return '日程内容须为 1 至 256 个字符';
	const time = /^([01]\d|2[0-3]):[0-5]\d$/;
	if (!time.test(value.startTime) || !time.test(value.endTime) || value.endTime <= value.startTime) return '结束时间须晚于开始时间';
	return '';
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
