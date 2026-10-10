import type { Locator, Page, Route } from '@playwright/test';

import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

test.use({ channel: 'msedge', viewport: { width: 1440, height: 1000 } });
type Action = 'add' | 'delete' | 'page' | 'preview' | 'update';
type Endpoint = 'add' | 'delete' | 'groupList' | 'page' | 'render' | 'update';
interface Row {
	[key: string]: unknown;
	id: number | string;
	name: string;
	code: string;
	groupName: string;
	type: number;
	content: string;
	orderNo: number;
	remark: string;
	tenantId: number | string;
}
interface Payload {
	[key: string]: unknown;
	id?: number | string;
	name?: string;
	code?: string;
	groupName?: string;
	type?: number;
	content?: string;
	orderNo?: number;
	remark?: string;
	tenantId?: number | string;
	page?: number;
	pageSize?: number;
	data?: Record<string, string>;
}
const original: Row = {
	id: '41',
	name: '欢迎模板',
	code: 'welcome',
	groupName: '业务通知',
	type: 1,
	content: '  <h2 data-keep="原文">@(name)</h2>\r\n<p>中文 &amp; 空格😀 @(city) @(name)</p>\r\n',
	orderNo: 100,
	remark: '原备注',
	tenantId: '1',
	createTime: '2026-01-01',
	extensionField: '保留字段',
};
const undeclared = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }, info) => {
	test.skip(info.project.name !== 'desktop', '本合同只验收桌面。');
	const unexpected: string[] = [];
	undeclared.set(page, unexpected);
	await page.route('**/prod-api/**', async (route) => {
		unexpected.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
		await route.fulfill({ status: 501, json: { code: 501, message: '未声明 Mock API' } });
	});
});
test.afterEach(async ({ page }) => {
	expect(undeclared.get(page) ?? []).toEqual([]);
});
function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}
async function setup(page: Page, options: { actions?: Action[]; alias?: boolean; rows?: Row[] } = {}) {
	await mockAdminSession(page, 'template', { templateActions: options.actions, templateMenuPath: options.alias ? '/platform/template' : undefined });
	const rows = (options.rows ?? [original]).map((row) => ({ ...row }));
	const calls: { endpoint: Endpoint; payload: Payload }[] = [];
	const failures = new Map<Endpoint, number>();
	const holds = new Map<Endpoint, Promise<void>>();
	let nextId = 1000;
	const replies = new Map<Endpoint, (payload: Payload) => unknown>();
	const count = (endpoint: Endpoint) => calls.filter((call) => call.endpoint === endpoint).length;
	for (const endpoint of ['page', 'groupList', 'add', 'update', 'delete', 'render'] as const) {
		await page.route('**/prod-api/api/sysTemplate/' + endpoint, async (route: Route) => {
			expect(route.request().method()).toBe(endpoint === 'groupList' ? 'GET' : 'POST');
			const payload: Payload = endpoint === 'groupList' ? {} : route.request().postDataJSON();
			calls.push({ endpoint, payload });
			const wait = holds.get(endpoint);
			if (wait) await wait;
			const fails = failures.get(endpoint) ?? 0;
			if (fails) {
				failures.set(endpoint, fails - 1);
				await route.fulfill({ json: { code: 500, message: '可恢复业务错误', result: null } }).catch(() => {});
				return;
			}
			let result: unknown;
			if (replies.has(endpoint)) result = replies.get(endpoint)?.(payload);
			else if (endpoint === 'page') {
				const selected = rows
					.filter(
						(row) =>
							(!payload.name || row.name.includes(payload.name)) &&
							(!payload.code || row.code.includes(payload.code)) &&
							(!payload.groupName || row.groupName.includes(payload.groupName)) &&
							(payload.type === undefined || row.type === payload.type)
					)
					.sort((left, right) => left.orderNo - right.orderNo || String(left.id).localeCompare(String(right.id)));
				const offset = ((payload.page ?? 1) - 1) * (payload.pageSize ?? 20);
				result = { items: selected.slice(offset, offset + (payload.pageSize ?? 20)).map((row) => ({ ...row })), total: selected.length };
			} else if (endpoint === 'groupList') result = [...new Set(rows.map((row) => row.groupName))];
			else if (endpoint === 'render') result = (payload.content ?? '').replace(/@\((.*?)\)/g, (_, key: string) => payload.data?.[key] ?? '');
			else if (endpoint === 'delete') {
				const index = rows.findIndex((row) => String(row.id) === String(payload.id));
				if (index >= 0) rows.splice(index, 1);
			} else if (endpoint === 'update') {
				const target = rows.find((row) => String(row.id) === String(payload.id));
				if (target) Object.assign(target, payload);
			} else
				rows.push({
					id: ++nextId,
					name: payload.name ?? '',
					code: payload.code ?? '',
					groupName: payload.groupName ?? '',
					type: payload.type ?? 1,
					content: payload.content ?? '',
					orderNo: payload.orderNo ?? 100,
					remark: payload.remark ?? '',
					tenantId: payload.tenantId ?? '1',
				});
			await route.fulfill({ json: { code: 200, result: result ?? null } }).catch(() => {});
		});
	}
	return { rows, calls, failures, holds, replies, count };
}
const pageRoot = (page: Page) => page.locator('.template-page:visible');
const rowNamed = (page: Page, name: string) =>
	pageRoot(page)
		.getByRole('row')
		.filter({ has: page.getByRole('cell', { name, exact: true }) });
const activePanel = (dialog: Locator) => dialog.locator('[role="tabpanel"]:visible');
async function open(page: Page) {
	await loginAdmin(page, 'template');
	await expect(pageRoot(page)).toBeVisible();
	expect(await page.locator('script[src*="@vite/client"]').count()).toBe(0);
	expect(await page.locator('script[type="module"][src]').evaluateAll((scripts) => scripts.map((script) => script.getAttribute('src')))).toEqual(
		expect.arrayContaining([expect.stringMatching(/\/jse\/[^/]+-[\w-]+\.js(?:\?|$)/)])
	);
}
async function contentPanel(dialog: Locator) {
	await dialog.getByRole('tab', { name: '模板内容', exact: true }).click();
	const panel = activePanel(dialog);
	await expect(panel.getByRole('radio', { name: '富文本', exact: true })).toBeVisible();
	return panel;
}
async function newPlain(page: Page, name = '合同纯文本') {
	await pageRoot(page).getByRole('button', { name: '新增模板', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '添加模板', exact: true });
	await activePanel(dialog).getByRole('textbox', { name: '模板名称', exact: true }).fill(name);
	await activePanel(dialog).getByRole('textbox', { name: '模板编码', exact: true }).fill('contract-plain');
	await expect(activePanel(dialog).getByRole('spinbutton', { name: '模板排序', exact: true })).toHaveValue('100');
	const panel = await contentPanel(dialog);
	await panel.getByRole('radio', { name: '纯文本', exact: true }).check();
	await panel.getByRole('textbox', { name: '模板内容', exact: true }).fill('欢迎 @(name)，城市 @(city)，再见 @(name) 😀\n  尾部空格  ');
	return { dialog, panel };
}
async function chooseSelect(page: Page, combo: Locator, label: string) {
	await combo.click();
	const dropdown = page.locator('.ant-select-dropdown:visible');
	const option = dropdown.locator('.ant-select-item-option-content').filter({ hasText: label });
	await expect(option).toHaveText(label);
	await option.click();
	await expect(dropdown).toHaveCount(0);
}
async function settleVisual(page: Page) {
	const notices = page.locator('.ant-notification-notice, .ant-message-notice');
	const interactive =
		'button, a, input, textarea, select, label, summary, iframe, [role="button"], [role="tab"], [role="menuitem"], [role="combobox"], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
	const parkMouse = async () => {
		const parking = { x: 0, y: 0 };
		await expect
			.poll(
				async () => {
					const candidate = await page.evaluate((selector) => {
						const roots = [...document.querySelectorAll<HTMLElement>('.ant-modal[role="dialog"]'), ...document.querySelectorAll<HTMLElement>('.template-page')].filter(
							(element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
						);
						for (const root of roots) {
							const bounds = root.getBoundingClientRect();
							for (let y = Math.max(0, bounds.top) + 8; y < Math.min(innerHeight, bounds.bottom) - 8; y += 24) {
								for (let x = Math.max(0, bounds.left) + 8; x < Math.min(innerWidth, bounds.right) - 8; x += 24) {
									const target = document.elementFromPoint(x, y);
									if (target && root.contains(target) && !target.closest(selector) && getComputedStyle(target).cursor !== 'pointer') return { x, y };
								}
							}
						}
						return null;
					}, interactive);
					if (candidate) Object.assign(parking, candidate);
					return candidate;
				},
				{ message: '截图前必须找到当前页面或弹窗内经 DOM 验证的非交互鼠标停放点。' }
			)
			.not.toBeNull();
		await page.mouse.move(parking.x, parking.y);
		return parking;
	};
	await parkMouse();
	await expect(notices).toHaveCount(0);
	await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
	await page.evaluate(async () => {
		await document.fonts.ready;
		const finite = document.getAnimations().filter((animation) => {
			const end = animation.effect?.getComputedTiming().endTime;
			return typeof end === 'number' && Number.isFinite(end) && (animation.playState === 'running' || animation.pending);
		});
		await Promise.all(finite.map((animation) => animation.finished.catch(() => {})));
		for (const element of document.querySelectorAll<HTMLElement>('*')) {
			const style = getComputedStyle(element);
			if (element.scrollTop || element.scrollLeft || /(auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY)) {
				element.scrollTop = 0;
				element.scrollLeft = 0;
			}
		}
		if (document.scrollingElement) {
			document.scrollingElement.scrollTop = 0;
			document.scrollingElement.scrollLeft = 0;
		}
	});
	const parking = await parkMouse();
	await expect(notices).toHaveCount(0);
	await expect
		.poll(
			() =>
				page.evaluate(
					({ point, selector }) => {
						const finiteAnimations = document
							.getAnimations()
							.filter((animation) => {
								const end = animation.effect?.getComputedTiming().endTime;
								return typeof end === 'number' && Number.isFinite(end) && (animation.playState === 'running' || animation.pending);
							})
							.map((animation) => ({ state: animation.playState, pending: animation.pending, endTime: animation.effect?.getComputedTiming().endTime }));
						const dialogs = [...document.querySelectorAll<HTMLElement>('.ant-modal[role="dialog"]')]
							.filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
							.map((element) => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform }))
							.filter(({ opacity, transform }) => opacity !== '1' || (transform !== 'none' && !new DOMMatrixReadOnly(transform).isIdentity));
						const scrolling = [...document.querySelectorAll<HTMLElement>('*')];
						if (document.scrollingElement && !scrolling.includes(document.scrollingElement as HTMLElement)) scrolling.push(document.scrollingElement as HTMLElement);
						const scrollOffsets = scrolling
							.filter((element) => element.scrollTop !== 0 || element.scrollLeft !== 0)
							.map((element) => ({ tag: element.tagName, id: element.id, className: element.className, top: element.scrollTop, left: element.scrollLeft }));
						const target = document.elementFromPoint(point.x, point.y);
						const control = target?.closest(selector);
						const cursor = target ? getComputedStyle(target).cursor : '';
						const pointer = target && !control && cursor !== 'pointer' ? [] : [{ ...point, tag: target?.tagName, className: target?.getAttribute('class'), control: control?.tagName, cursor }];
						return { finiteAnimations, dialogs, scrollOffsets, pointer };
					},
					{ point: parking, selector: interactive }
				),
			{ message: '截图前有限动画、Modal 终态、真实滚动顶和鼠标非交互点必须全部就绪。' }
		)
		.toEqual({ finiteAnimations: [], dialogs: [], scrollOffsets: [], pointer: [] });
}

async function toolbarContrast(button: Locator) {
	return button.evaluate((element) => {
		type Rgb = [number, number, number];
		type Rgba = [number, number, number, number];
		const parseColor = (value: string): Rgba => {
			const match = /^rgba?\(([^)]+)\)$/.exec(value);
			if (!match) throw new Error('无法计算实际颜色的相对亮度：' + value);
			const channels = match[1]!
				.split(/[,\s/]+/)
				.filter(Boolean)
				.map(Number);
			if (channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) throw new Error('实际颜色通道无效：' + value);
			return [channels[0]!, channels[1]!, channels[2]!, channels[3] ?? 1];
		};
		const composite = (foreground: Rgba, background: Rgb): Rgb => [
			foreground[0] * foreground[3] + background[0] * (1 - foreground[3]),
			foreground[1] * foreground[3] + background[1] * (1 - foreground[3]),
			foreground[2] * foreground[3] + background[2] * (1 - foreground[3]),
		];
		const luminance = (color: Rgb) => {
			const linear = color.map((channel) => {
				const value = channel / 255;
				return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
			});
			return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
		};
		const svg = element.querySelector('svg');
		if (!svg) throw new Error('工具栏按钮必须包含实际绘制的 SVG。');
		const layers = [];
		for (let ancestor: Element | null = svg; ancestor; ancestor = ancestor.parentElement) {
			const style = getComputedStyle(ancestor);
			if (style.opacity !== '1' || style.backgroundImage !== 'none') throw new Error('截图前工具栏祖先必须完全不透明且无未计算的背景图层：' + ancestor.tagName);
			layers.push({ tag: ancestor.tagName, color: style.backgroundColor, rgba: parseColor(style.backgroundColor) });
		}
		let background: Rgb = [255, 255, 255];
		for (const layer of [...layers].reverse()) background = composite(layer.rgba, background);
		const shapes = [...svg.querySelectorAll<SVGElement>('path, rect, circle, ellipse, polygon, polyline, text, use')];
		const fills = (shapes.length ? shapes : [svg])
			.filter((shape) => shape.getClientRects().length > 0 && getComputedStyle(shape).fill !== 'none')
			.map((shape) => {
				const style = getComputedStyle(shape);
				const color = parseColor(style.fill);
				color[3] *= Number(style.fillOpacity) * Number(style.opacity);
				const foreground = composite(color, background);
				const first = luminance(foreground);
				const second = luminance(background);
				return { tag: shape.tagName, fill: style.fill, fillOpacity: style.fillOpacity, foreground, contrast: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05) };
			});
		if (!fills.length) throw new Error('工具栏 SVG 必须包含实际可见的填充图形。');
		return {
			active: element.classList.contains('active'),
			hovered: element.matches(':hover'),
			disabled: element.classList.contains('disabled'),
			svgFill: getComputedStyle(svg).fill,
			background,
			backgroundLayers: layers.filter((layer) => layer.rgba[3] > 0),
			fills,
			minimumContrast: Math.min(...fills.map((fill) => fill.contrast)),
		};
	});
}

test('普通 page 角色读取分页和分组但没有写入或预览', async ({ page }) => {
	const fixture = await setup(page, { actions: ['page'] });
	await open(page);
	await expect(rowNamed(page, original.name)).toHaveCount(1);
	for (const name of ['新增模板', '编辑模板', '删除模板', '预览模板']) await expect(pageRoot(page).getByRole('button', { name, exact: true })).toHaveCount(0);
	expect(fixture.calls.find((call) => call.endpoint === 'page')?.payload).toMatchObject({ page: 1, pageSize: 20, tenantId: 1 });
	expect(fixture.count('groupList')).toBe(1);
});
for (const action of ['add', 'update', 'delete', 'preview'] as const) {
	test('普通 page + ' + action + ' 角色动作独立可用', async ({ page }) => {
		const fixture = await setup(page, { actions: ['page', action] });
		await open(page);
		await expect(rowNamed(page, original.name)).toHaveCount(1);
		const names = { add: '新增模板', update: '编辑模板', delete: '删除模板', preview: '预览模板' };
		for (const key of ['add', 'update', 'delete', 'preview'] as const) await expect(pageRoot(page).getByRole('button', { name: names[key], exact: true })).toHaveCount(key === action ? 1 : 0);
		await pageRoot(page).getByRole('button', { name: names[action], exact: true }).click();
		if (action === 'delete') {
			await page.getByRole('dialog', { name: '删除模板', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
			expect(fixture.count('delete')).toBe(0);
		} else {
			const dialog = page.getByRole('dialog', { name: action === 'add' ? '添加模板' : action === 'update' ? '编辑模板' : '预览模板', exact: true });
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole('button', { name: '保存模板', exact: true })).toHaveCount(action === 'preview' ? 0 : 1);
			const panel = await contentPanel(dialog);
			await expect(panel.getByRole('button', { name: '渲染模板', exact: true })).toHaveCount(action === 'preview' ? 1 : 0);
			if (action === 'preview') {
				await panel.getByRole('button', { name: '渲染模板', exact: true }).click();
				await expect(panel.getByLabel('渲染结果', { exact: true })).toBeVisible();
				expect(fixture.count('render')).toBe(1);
			}
		}
	});
}
test('无 page 权限不发送列表或分组请求', async ({ page }) => {
	const fixture = await setup(page, { actions: ['add', 'update', 'delete', 'preview'] });
	await open(page);
	await expect(pageRoot(page)).toContainText('没有查询模板权限');
	expect(fixture.count('page')).toBe(0);
	expect(fixture.count('groupList')).toBe(0);
});
test('历史 alias、名称/编码/分组 Contains、类型和默认 20 条分页', async ({ page }) => {
	const rows = Array.from({ length: 23 }, (_, index) => ({
		...original,
		id: index + 1,
		name: index === 21 ? '企业微信合同' : '列表模板 ' + String(index + 1),
		code: 'contract-' + String(index + 1),
		groupName: index === 21 ? '企业合同分组' : '普通分组',
		type: index === 21 ? 7 : 1,
	}));
	const fixture = await setup(page, { alias: true, rows });
	await open(page);
	await expect(pageRoot(page).getByRole('row')).toHaveCount(21);
	await pageRoot(page).getByRole('button', { name: '下一页', exact: true }).click();
	await expect.poll(() => fixture.calls.filter((call) => call.endpoint === 'page').at(-1)?.payload.page).toBe(2);
	await pageRoot(page).getByRole('textbox', { name: '查询模板名称', exact: true }).fill('合同');
	await pageRoot(page).getByRole('textbox', { name: '查询模板编码', exact: true }).fill('22');
	await pageRoot(page).getByRole('combobox', { name: '查询模板分组', exact: true }).fill('企业合同');
	await chooseSelect(page, pageRoot(page).getByRole('combobox', { name: '查询模板类型', exact: true }), '企业微信');
	await pageRoot(page).getByRole('button', { name: '查询模板', exact: true }).click();
	await expect(rowNamed(page, '企业微信合同')).toHaveCount(1);
	expect(fixture.calls.filter((call) => call.endpoint === 'page').at(-1)?.payload).toMatchObject({ name: '合同', code: '22', groupName: '企业合同', type: 7, page: 1, pageSize: 20 });
	await page.evaluate(() => {
		window.location.hash = '/platform/template';
	});
	await expect(pageRoot(page)).toHaveCount(1);
	await expect(pageRoot(page)).toBeVisible();
});
test('富/纯初始化、切换和无改保存保持 HTML/CRLF/Unicode/扩展字段原文', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await rowNamed(page, original.name).getByRole('button', { name: '编辑模板', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑模板', exact: true });
	const panel = await contentPanel(dialog);
	await expect(panel.getByRole('textbox', { name: '模板内容', exact: true })).toBeVisible();
	await panel.getByRole('radio', { name: '纯文本', exact: true }).check();
	await panel.getByRole('radio', { name: '富文本', exact: true }).check();
	await expect(panel.getByRole('textbox', { name: '模板内容', exact: true })).toBeVisible();
	await panel.getByRole('button', { name: '切换到源码编辑', exact: true }).click();
	await panel.getByRole('button', { name: '切换到可视编辑', exact: true }).click();
	await expect(panel.getByRole('textbox', { name: '模板内容', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: '保存模板', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	const payload = fixture.calls.find((call) => call.endpoint === 'update')?.payload;
	expect(payload).toEqual(original);
	expect(payload).not.toHaveProperty('contentType');
	await rowNamed(page, original.name).getByRole('button', { name: '编辑模板', exact: true }).click();
	const reopened = await contentPanel(page.getByRole('dialog', { name: '编辑模板', exact: true }));
	await reopened.getByRole('radio', { name: '纯文本', exact: true }).check();
	await expect(reopened.getByRole('textbox', { name: '模板内容', exact: true })).toHaveValue(original.content.replaceAll('\r\n', '\n'));
});
test('参数保值/增删/插入、字符串 render 载荷与语法失败重试', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	const { dialog, panel } = await newPlain(page);
	await expect(panel.getByRole('textbox', { name: /^预览参数名 / })).toHaveCount(2);
	await panel.getByRole('textbox', { name: '预览参数值 1', exact: true }).fill('张三');
	await panel.getByRole('textbox', { name: '预览参数值 2', exact: true }).fill('上海');
	await panel.getByRole('textbox', { name: '待插入参数名', exact: true }).fill('name');
	await panel.getByRole('button', { name: '插入参数', exact: true }).click();
	await expect(panel.getByRole('textbox', { name: '预览参数值 1', exact: true })).toHaveValue('张三');
	await panel.getByRole('button', { name: '添加预览参数', exact: true }).click();
	await panel.getByRole('textbox', { name: '预览参数名 3', exact: true }).fill('__proto__');
	await panel.getByRole('textbox', { name: '预览参数值 3', exact: true }).fill('字符串');
	const raw = await panel.getByRole('textbox', { name: '模板内容', exact: true }).inputValue();
	fixture.failures.set('render', 1);
	await panel.getByRole('button', { name: '渲染模板', exact: true }).click();
	await expect(panel.getByLabel('模板渲染错误')).toContainText('原文和参数已保留');
	await expect(panel.getByRole('textbox', { name: '模板内容', exact: true })).toHaveValue(raw);
	await panel.getByRole('button', { name: '渲染模板', exact: true }).click();
	await expect(panel.getByLabel('渲染结果', { exact: true })).toContainText('欢迎 张三，城市 上海');
	expect(fixture.calls.filter((call) => call.endpoint === 'render').at(-1)?.payload).toEqual({ content: raw, data: { name: '张三', city: '上海', ['__proto__']: '字符串' } });
	await panel.getByRole('button', { name: '删除预览参数 3', exact: true }).click();
	await expect(panel.getByRole('textbox', { name: /^预览参数名 / })).toHaveCount(2);
	await dialog.getByRole('button', { name: '取消', exact: true }).click();
});
test('保存失败保留草稿并恢复成功，CRUD 刷新分组且删除取消零请求', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	const { dialog, panel } = await newPlain(page);
	await panel.getByRole('textbox', { name: '预览参数值 1', exact: true }).fill('保留参数');
	fixture.failures.set('add', 1);
	await dialog.getByRole('button', { name: '保存模板', exact: true }).click();
	await expect(dialog.getByLabel('模板操作错误')).toContainText('预览参数已保留');
	await expect(panel.getByRole('textbox', { name: '预览参数值 1', exact: true })).toHaveValue('保留参数');
	await dialog.getByRole('button', { name: '保存模板', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(rowNamed(page, '合同纯文本')).toHaveCount(1);
	await expect.poll(() => fixture.count('groupList')).toBe(2);
	await rowNamed(page, '合同纯文本').getByRole('button', { name: '删除模板', exact: true }).click();
	await page.getByRole('dialog', { name: '删除模板', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
	expect(fixture.count('delete')).toBe(0);
	await rowNamed(page, '合同纯文本').getByRole('button', { name: '删除模板', exact: true }).click();
	await page.getByRole('dialog', { name: '删除模板', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click();
	await expect(rowNamed(page, '合同纯文本')).toHaveCount(0);
	await expect.poll(() => fixture.count('groupList')).toBe(3);
});
test('真实富文本格式按钮产生格式化 Content，明暗 active/hover 对比度达标并可保存后重开', async ({ page }, info) => {
	const rows = (['light', 'dark'] as const).map((colorScheme, index) => ({
		...original,
		id: index + 1,
		name: '真实格式模板 ' + colorScheme,
		code: 'format-' + colorScheme,
		content: '<p>原始格式内容</p>',
	}));
	const fixture = await setup(page, { rows });
	await open(page);
	for (const colorScheme of ['light', 'dark'] as const) {
		if ((await page.locator('html').getAttribute('class'))?.includes('dark') !== (colorScheme === 'dark')) await page.getByRole('button', { name: colorScheme, exact: true }).click();
		await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(colorScheme === 'dark');
		await settleVisual(page);
		const rowName = '真实格式模板 ' + colorScheme;
		await rowNamed(page, rowName).getByRole('button', { name: '编辑模板', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: '编辑模板', exact: true });
		const panel = await contentPanel(dialog);
		const textbox = panel.getByRole('textbox', { name: '模板内容', exact: true });
		await expect(textbox).toBeVisible();
		await expect(textbox).toHaveAttribute('contenteditable', 'true');
		await expect(textbox).toHaveAttribute('aria-readonly', 'false');
		await textbox.fill('实际富文本格式操作');
		await textbox.press('ControlOrMeta+a');
		const bold = panel.locator('.template-rich-toolbar button[data-menu-key="bold"]');
		await expect(bold).not.toHaveClass(/\bdisabled\b/);
		await bold.click();
		await expect(textbox.locator('strong, b')).toHaveText('实际富文本格式操作');
		await expect(bold).toHaveClass(/\bactive\b/);
		await settleVisual(page);
		const active = await toolbarContrast(bold);
		expect(active.active).toBe(true);
		expect(active.hovered).toBe(false);
		expect(active.disabled).toBe(false);
		const activePath = info.outputPath('template-bold-' + colorScheme + '-active-contrast.json');
		await writeFile(activePath, JSON.stringify(active, null, 2), 'utf8');
		await info.attach('template-bold-' + colorScheme + '-active-contrast', { path: activePath, contentType: 'application/json' });
		expect(active.minimumContrast, colorScheme + ' active SVG/实际背景：' + JSON.stringify(active)).toBeGreaterThanOrEqual(3);
		await dialog.screenshot({ path: info.outputPath('template-bold-active-' + colorScheme + '.png') });
		await bold.hover();
		await expect
			.poll(() => bold.evaluate((element) => ({ hovered: element.matches(':hover'), tooltipOpacity: getComputedStyle(element, '::before').opacity })))
			.toEqual({ hovered: true, tooltipOpacity: '1' });
		const hovered = await toolbarContrast(bold);
		expect(hovered.active).toBe(true);
		expect(hovered.hovered).toBe(true);
		expect(hovered.disabled).toBe(false);
		const hoverPath = info.outputPath('template-bold-' + colorScheme + '-hover-contrast.json');
		await writeFile(hoverPath, JSON.stringify(hovered, null, 2), 'utf8');
		await info.attach('template-bold-' + colorScheme + '-hover-contrast', { path: hoverPath, contentType: 'application/json' });
		expect(hovered.minimumContrast, colorScheme + ' hover SVG/实际背景：' + JSON.stringify(hovered)).toBeGreaterThanOrEqual(3);
		await dialog.screenshot({ path: info.outputPath('template-bold-hover-' + colorScheme + '.png') });
		await panel.getByRole('button', { name: '切换到源码编辑', exact: true }).click();
		const source = panel.getByRole('textbox', { name: '模板内容', exact: true });
		await expect(source).toHaveValue(/<(?:strong|b)>实际富文本格式操作<\/(?:strong|b)>/);
		const formatted = await source.inputValue();
		await panel.getByRole('button', { name: '渲染模板', exact: true }).click();
		await expect(panel.getByLabel('渲染结果', { exact: true }).locator('iframe').contentFrame().locator('strong, b')).toHaveText('实际富文本格式操作');
		expect(fixture.calls.filter((call) => call.endpoint === 'render').at(-1)?.payload.content).toBe(formatted);
		await dialog.getByRole('button', { name: '保存模板', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		expect(fixture.calls.filter((call) => call.endpoint === 'update').at(-1)?.payload.content).toBe(formatted);
		expect(formatted).toMatch(/<(?:strong|b)>/);
		await rowNamed(page, rowName).getByRole('button', { name: '编辑模板', exact: true }).click();
		const reopenedDialog = page.getByRole('dialog', { name: '编辑模板', exact: true });
		const reopened = await contentPanel(reopenedDialog);
		await expect(reopened.getByRole('textbox', { name: '模板内容', exact: true })).toContainText('实际富文本格式操作');
		await expect(reopened.getByRole('textbox', { name: '模板内容', exact: true }).locator('strong, b')).toHaveText('实际富文本格式操作');
		await reopened.getByRole('button', { name: '切换到源码编辑', exact: true }).click();
		await expect(reopened.getByRole('textbox', { name: '模板内容', exact: true })).toHaveValue(formatted);
		await reopenedDialog.getByRole('button', { name: '取消', exact: true }).click();
		await expect(reopenedDialog).toHaveCount(0);
	}
});

test('富文本结果隔离脚本、parent 导航与外部网络，原始输出仍可查看', async ({ page }) => {
	const fixture = await setup(page);
	const probes: string[] = [];
	await page.route('https://template-contract.invalid/**', async (route) => {
		probes.push(route.request().url());
		await route.fulfill({ status: 204, body: '' });
	});
	fixture.replies.set(
		'render',
		() =>
			'<h2>安全结果</h2><script>parent.__templateScriptExecuted=true;parent.location="https://template-contract.invalid/navigation";fetch("https://template-contract.invalid/fetch")</script><img src="https://template-contract.invalid/image"><meta http-equiv="refresh" content="0;url=https://template-contract.invalid/refresh"><p><a target="_top" href="https://template-contract.invalid/link">导航链接</a></p><p style="background-image:url(https://template-contract.invalid/css)">样式探针</p>'
	);
	await open(page);
	await rowNamed(page, original.name).getByRole('button', { name: '预览模板', exact: true }).click();
	const panel = await contentPanel(page.getByRole('dialog', { name: '预览模板', exact: true }));
	const url = page.url();
	await panel.getByRole('button', { name: '渲染模板', exact: true }).click();
	const result = panel.getByLabel('渲染结果', { exact: true });
	await expect(result).toBeVisible();
	const frame = result.locator('iframe[title="富文本渲染预览"]');
	await expect(frame).toHaveAttribute('sandbox', '');
	await expect(frame.contentFrame().getByRole('heading', { name: '安全结果', exact: true })).toBeVisible();
	await frame.contentFrame().getByText('导航链接', { exact: true }).click();
	await expect.poll(() => page.url()).toBe(url);
	expect(probes).toEqual([]);
	expect(await page.evaluate(() => Object.hasOwn(window, '__templateScriptExecuted'))).toBe(false);
	await result.getByText('查看原始输出', { exact: true }).click();
	await expect(result.getByLabel('原始渲染输出')).toContainText('<script>');
	await expect(page.locator('script').filter({ hasText: 'template-contract.invalid' })).toHaveCount(0);
});
test('KeepAlive 离页取消渲染和列表，迟到结果不带入重开页面', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await rowNamed(page, original.name).getByRole('button', { name: '编辑模板', exact: true }).click();
	const panel = await contentPanel(page.getByRole('dialog', { name: '编辑模板', exact: true }));
	const held = gate();
	fixture.holds.set('render', held.promise);
	await panel.getByRole('button', { name: '渲染模板', exact: true }).click();
	await expect.poll(() => fixture.count('render')).toBe(1);
	try {
		await page.evaluate(() => {
			window.location.hash = '/template-contract-away';
		});
		await expect(pageRoot(page)).toHaveCount(0);
		await expect(page.getByRole('dialog', { name: '编辑模板', exact: true })).toHaveCount(0);
	} finally {
		fixture.holds.clear();
		held.release();
	}
	await page.evaluate(() => {
		window.location.hash = '/system/template';
	});
	await expect(pageRoot(page)).toBeVisible();
	await expect.poll(() => fixture.count('page')).toBe(2);
	await expect(page.getByLabel('渲染结果', { exact: true })).toHaveCount(0);
	await rowNamed(page, original.name).getByRole('button', { name: '编辑模板', exact: true }).click();
	await contentPanel(page.getByRole('dialog', { name: '编辑模板', exact: true }));
	await expect(page.getByLabel('渲染结果', { exact: true })).toHaveCount(0);
});
for (const colorScheme of ['light', 'dark'] as const) {
	test(colorScheme + ' 桌面列表、完整编辑器与渲染结果截图', async ({ page }, info) => {
		await setup(page);
		await open(page);
		await expect(rowNamed(page, original.name)).toHaveCount(1);
		if ((await page.locator('html').getAttribute('class'))?.includes('dark') !== (colorScheme === 'dark')) await page.getByRole('button', { name: colorScheme, exact: true }).click();
		await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(colorScheme === 'dark');
		await settleVisual(page);
		await page.screenshot({ path: info.outputPath('template-table-' + colorScheme + '.png'), fullPage: true });
		await rowNamed(page, original.name).getByRole('button', { name: '编辑模板', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: '编辑模板', exact: true });
		const panel = await contentPanel(dialog);
		await expect(panel.getByRole('textbox', { name: '模板内容', exact: true })).toBeVisible();
		await settleVisual(page);
		await dialog.screenshot({ path: info.outputPath('template-editor-' + colorScheme + '.png') });
		await panel.getByRole('textbox', { name: '预览参数值 1', exact: true }).fill('张三');
		await panel.getByRole('textbox', { name: '预览参数值 2', exact: true }).fill('上海');
		await panel.getByRole('button', { name: '渲染模板', exact: true }).click();
		const result = panel.getByLabel('渲染结果', { exact: true });
		await expect(result.locator('iframe').contentFrame().getByRole('heading', { name: '张三', exact: true })).toBeVisible();
		await settleVisual(page);
		await result.screenshot({ path: info.outputPath('template-render-' + colorScheme + '.png') });
	});
}
