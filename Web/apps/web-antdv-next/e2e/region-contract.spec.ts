import type { Locator, Page } from '@playwright/test';

import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

// 此文件只验证生产页面与显式 Mock 合同；真实 PostgreSQL CRUD 由独立基线验收。
test.use({ channel: 'msedge', viewport: { width: 1440, height: 1000 } });

type Id = number | string;
type Row = { id: Id; pid: Id; name: string; code: string; orderNo: number; cityCode?: string; remark?: string; [field: string]: unknown };
type Call = { action: string; method: string; body: Record<string, unknown> };
const rootId = '9007199254740993';
const cityId = '9007199254740994';
const leafId = '9007199254740995';
const originalCity: Row = {
	id: cityId,
	pid: rootId,
	name: '成都市',
	code: '510100',
	cityCode: '028',
	orderNo: 2,
	remark: '中文长备注：此记录包含原有行政区域隐藏字段，编辑只修改可见字段，保留拼音、邮编、经纬度和原上级。',
	shortName: '成都',
	mergerName: '中国,四川省,成都市',
	zipCode: '610000',
	level: 2,
	pinYin: 'Chengdu',
	lng: 104.06,
	lat: 30.67,
};
const seed: Row[] = [
	{ id: rootId, pid: 0, name: '四川省', code: '510000', orderNo: 1 },
	originalCity,
	{ id: leafId, pid: cityId, name: '锦江区', code: '510104', orderNo: 3 },
	{ id: 20, pid: 0, name: '北京市', code: '110000', orderNo: 4 },
];
const sameId = (left: unknown, right: unknown) => String(left) === String(right);
const undeclared = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, isMobile }) => {
	test.skip(isMobile, '仅验收桌面端');
	const unexpected: string[] = [];
	undeclared.set(page, unexpected);
	await page.route('**/prod-api/**', async (route) => {
		unexpected.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
		await route.fulfill({ status: 501, json: { code: 501, message: '未声明 API' } });
	});
});
test.afterEach(async ({ page }) => {
	expect(undeclared.get(page) ?? [], '不得访问未声明的 API').toEqual([]);
});

async function setup(page: Page, options: { actions?: ('add' | 'delete' | 'page' | 'update')[]; alias?: boolean; rows?: Row[] } = {}) {
	await mockAdminSession(page, 'region', { regionActions: options.actions, regionMenuPath: options.alias ? '/platform/region' : undefined });
	let rows = structuredClone(options.rows ?? seed);
	const calls: Call[] = [];
	const failures = { tree: 0, page: 0, add: 0, update: 0, delete: 0 };
	const holds = new Map<string, Promise<void>>();
	const tree = (pid: Id = 0): unknown[] =>
		rows
			.filter((row) => sameId(row.pid, pid))
			.sort((a, b) => a.orderNo - b.orderNo)
			.map((row) => ({ ...row, children: tree(row.id) }));
	for (const action of ['tree', 'page', 'add', 'update', 'delete'] as const) {
		await page.route('**/prod-api/api/sysRegion/' + action, async (route) => {
			const method = route.request().method();
			const body = method === 'POST' ? (route.request().postDataJSON() as Record<string, unknown>) : {};
			calls.push({ action, method, body });
			if (method !== (action === 'tree' ? 'GET' : 'POST')) {
				undeclared.get(page)?.push(method + ' sysRegion/' + action);
				await route.fulfill({ status: 405 });
				return;
			}
			await holds.get(action);
			if (failures[action] > 0) {
				failures[action]--;
				await route.fulfill({ json: { code: 500, message: '测试服务失败' } }).catch(() => {});
				return;
			}
			let result: unknown;
			if (action === 'tree') result = tree();
			if (action === 'page') {
				const matches = rows.filter(
					(row) => (sameId(body.pid, 0) || sameId(row.id, body.pid) || sameId(row.pid, body.pid)) && row.name.includes(String(body.name ?? '')) && row.code.includes(String(body.code ?? ''))
				);
				const pageNo = Number(body.page);
				const pageSize = Number(body.pageSize);
				result = { items: matches.slice((pageNo - 1) * pageSize, pageNo * pageSize), total: matches.length };
			}
			if (action === 'add' || action === 'update') {
				if (rows.some((row) => row.name === body.name && row.code === body.code && !sameId(row.id, body.id))) {
					await route.fulfill({ json: { code: 500, message: '名称和代码组合已存在' } });
					return;
				}
				if (action === 'add') {
					const id = 100 + rows.length;
					rows.push({ ...body, id } as Row);
					result = id;
				} else rows = rows.map((row) => (sameId(row.id, body.id) ? ({ ...row, ...body } as Row) : row));
			}
			if (action === 'delete') {
				const removed = new Set([String(body.id)]);
				let changed = true;
				while (changed) {
					changed = false;
					for (const row of rows)
						if (removed.has(String(row.pid)) && !removed.has(String(row.id))) {
							removed.add(String(row.id));
							changed = true;
						}
				}
				rows = rows.filter((row) => !removed.has(String(row.id)));
			}
			await route.fulfill({ json: { code: 200, result } }).catch(() => {});
		});
	}
	return {
		calls,
		failures,
		holds,
		count: (action: string) => calls.filter((call) => call.action === action).length,
		last: (action: string) => calls.filter((call) => call.action === action).at(-1),
		records: () => rows,
	};
}

async function open(page: Page) {
	await loginAdmin(page, 'region');
	await expect(page.locator('.region-page')).toBeVisible();
	await expect(page.locator('script[src*="/@vite/client"]')).toHaveCount(0);
	const scripts = page.locator('script[type="module"][src^="/jse/"]');
	await expect(scripts).toHaveCount(1);
	expect(await scripts.getAttribute('src')).toMatch(/^\/jse\/.+-[\w-]+\.js$/);
}
const list = (page: Page) => page.getByRole('region', { name: '区域列表', exact: true });
const row = (page: Page, name: string) =>
	list(page)
		.getByRole('row')
		.filter({ has: page.getByText(name, { exact: true }) });
async function select(page: Page, name: string) {
	await page.getByRole('button', { name: '全部展开', exact: true }).click();
	await page.getByRole('tree', { name: '区域导航', exact: true }).getByText(name, { exact: true }).click();
}
async function fillEditor(dialog: Locator, name: string, code: string) {
	await dialog.getByLabel('行政名称', { exact: true }).fill(name);
	await dialog.getByLabel('行政代码', { exact: true }).fill(code);
}
function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

// 截图只等待有限动画，并验证实际滚动容器的位置。
async function settleVisual(page: Page) {
	await expect(page.locator('.region-page')).toHaveCount(1);
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
	await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
	await page.evaluate(async () => {
		await document.fonts.ready;
		const finite = document.getAnimations().filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
		await Promise.race([Promise.allSettled(finite.map((animation) => animation.finished)), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('有限动画未停止')), 5000))]);
		for (const element of Array.from(document.querySelectorAll<HTMLElement>('*')))
			if (element.scrollHeight > element.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)) element.scrollTop = 0;
		document.scrollingElement?.scrollTo({ top: 0, left: 0 });
	});
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Array.from(document.querySelectorAll<HTMLElement>('*'))
						.filter((element) => element.scrollHeight > element.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
						.every((element) => element.scrollTop === 0) && (document.scrollingElement?.scrollTop ?? 0) === 0
			)
		)
		.toBe(true);
}

test('普通 777 账号加载生产区域页面、兼容旧菜单和 platform alias', async ({ page }) => {
	const fixture = await setup(page, { alias: true });
	await open(page);
	await expect(row(page, '四川省')).toHaveCount(1);
	await expect(row(page, '成都市')).toHaveCount(1);
	await expect(row(page, '锦江区')).toHaveCount(1);
	expect(fixture.last('page')).toMatchObject({ method: 'POST', body: { pid: 0, name: '', code: '', page: 1, pageSize: 50 } });
	await page.evaluate(() => {
		window.location.hash = '/platform/region';
	});
	await expect(page.locator('.region-page')).toHaveCount(1);
	await expect(page.getByRole('button', { name: '新增区域', exact: true })).toBeVisible();
});

test('page 权限缺失完全不加载共享 tree，也不提供写入口', async ({ page }) => {
	const fixture = await setup(page, { actions: ['add', 'update', 'delete'] });
	await open(page);
	await expect(page.getByText('无区域管理查看权限', { exact: true })).toBeVisible();
	expect(fixture.calls).toEqual([]);
});

test('只读账号可导航查询，add/update/delete 分别受权限限制', async ({ page }) => {
	const fixture = await setup(page, { actions: ['page'] });
	await open(page);
	await expect(row(page, '四川省')).toHaveCount(1);
	await expect(page.getByRole('button', { name: '新增区域', exact: true })).toHaveCount(0);
	await expect(list(page).getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
	await expect(list(page).getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
	await select(page, '成都市');
	await expect.poll(() => fixture.last('page')?.body.pid).toBe(cityId);
	expect(fixture.count('add') + fixture.count('update') + fixture.count('delete')).toBe(0);
});

for (const allowed of ['add', 'update', 'delete'] as const) {
	test(allowed + ' 权限独立显示入口，不要求超级管理员', async ({ page }) => {
		await setup(page, { actions: ['page', allowed] });
		await open(page);
		await expect(row(page, '成都市')).toHaveCount(1);
		await expect(page.getByRole('button', { name: '新增区域', exact: true })).toHaveCount(allowed === 'add' ? 1 : 0);
		await expect(row(page, '成都市').getByRole('button', { name: '编辑', exact: true })).toHaveCount(allowed === 'update' ? 1 : 0);
		await expect(row(page, '成都市').getByRole('button', { name: '删除', exact: true })).toHaveCount(allowed === 'delete' ? 1 : 0);
	});
}

test('树筛选保留祖先，选树包含自身及直接子级，查询和重置按合同发送', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await page.getByRole('textbox', { name: '筛选区域树', exact: true }).fill('510104');
	const navigation = page.getByRole('tree', { name: '区域导航', exact: true });
	await expect(navigation.getByText('四川省', { exact: true })).toBeVisible();
	await expect(navigation.getByText('锦江区', { exact: true })).toBeVisible();
	await page.getByRole('textbox', { name: '筛选区域树', exact: true }).fill('');
	await select(page, '成都市');
	await expect(row(page, '成都市')).toHaveCount(1);
	await expect(row(page, '锦江区')).toHaveCount(1);
	await expect(row(page, '四川省')).toHaveCount(0);
	await page.getByRole('textbox', { name: '查询行政名称', exact: true }).fill(' 锦江 ');
	await page.getByRole('textbox', { name: '查询行政代码', exact: true }).fill(' 510104 ');
	await page.getByRole('button', { name: '查询', exact: true }).click();
	await expect.poll(() => fixture.last('page')?.body).toEqual({ pid: cityId, name: '锦江', code: '510104', page: 1, pageSize: 50 });
	await select(page, '四川省');
	await expect(page.getByRole('textbox', { name: '查询行政名称', exact: true })).toHaveValue('');
	await expect.poll(() => fixture.last('page')?.body).toEqual({ pid: rootId, name: '', code: '', page: 1, pageSize: 50 });
	await page.getByRole('button', { name: '重置', exact: true }).click();
	await expect.poll(() => fixture.last('page')?.body.pid).toBe(0);
	await expect(row(page, '北京市')).toHaveCount(1);
});

test('分页默认为 50，切树后回到第 1 页', async ({ page }) => {
	const extra = Array.from({ length: 52 }, (_, index): Row => ({ id: 200 + index, pid: 0, name: '批量区域' + index, code: '120000', orderNo: 100 + index }));
	const fixture = await setup(page, { rows: [...seed, ...extra] });
	await open(page);
	await expect(list(page).getByTitle('2', { exact: true })).toBeVisible();
	await list(page).getByTitle('2', { exact: true }).click();
	await expect.poll(() => fixture.last('page')?.body.page).toBe(2);
	await select(page, '成都市');
	await expect.poll(() => fixture.last('page')?.body).toEqual({ pid: cityId, name: '', code: '', page: 1, pageSize: 50 });
});

test('添加使用选中上级、取消不请求，允许同 code 不同 name 且刷新祖先子级', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await select(page, '成都市');
	await page.getByRole('button', { name: '新增区域', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '添加行政区域', exact: true });
	await expect(dialog.getByLabel('上级行政', { exact: true })).toHaveValue('四川省 / 成都市');
	await expect(dialog.getByLabel('上级行政', { exact: true })).toHaveAttribute('readonly', '');
	await expect(dialog.getByLabel('排序', { exact: true })).toHaveValue('100');
	await dialog.getByRole('button', { name: '取消', exact: true }).click();
	expect(fixture.count('add')).toBe(0);
	await page.getByRole('button', { name: '新增区域', exact: true }).click();
	await fillEditor(dialog, '新区域', ' 510104 ');
	await dialog.getByRole('button', { name: '保存', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	expect(fixture.last('add')?.body).toMatchObject({ pid: cityId, name: '新区域', code: '510104', orderNo: 100 });
	await expect(row(page, '新区域')).toHaveCount(1);
	await expect(page.getByRole('tree', { name: '区域导航', exact: true }).getByText('新区域', { exact: true })).toBeVisible();
	expect(fixture.count('tree')).toBeGreaterThan(1);
});

test('编辑只读原上级，无损保留隐藏字段和 string ID/pid', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await row(page, '成都市').getByRole('button', { name: '编辑', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑行政区域', exact: true });
	await expect(dialog.getByLabel('上级行政', { exact: true })).toHaveValue('四川省');
	await expect(dialog.getByLabel('上级行政', { exact: true })).toHaveAttribute('readonly', '');
	await dialog.getByRole('button', { name: '取消', exact: true }).click();
	expect(fixture.count('update')).toBe(0);
	await row(page, '成都市').getByRole('button', { name: '编辑', exact: true }).click();
	await dialog.getByLabel('备注', { exact: true }).fill('编辑后完整备注');
	await dialog.getByRole('button', { name: '保存', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	expect(fixture.last('update')?.body).toEqual({ ...originalCity, remark: '编辑后完整备注' });
	await expect(row(page, '成都市')).toContainText('编辑后完整备注');
	expect(fixture.count('tree')).toBeGreaterThan(1);
});

test('非法长度及空名称阻止请求，服务失败保留可编辑草稿，忙时防重复', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await page.getByRole('button', { name: '新增区域', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '添加行政区域', exact: true });
	await dialog.getByRole('button', { name: '保存', exact: true }).click();
	await expect(dialog).toContainText('请输入行政名称');
	await fillEditor(dialog, '保留草稿', '123');
	await dialog.getByRole('button', { name: '保存', exact: true }).click();
	await expect(dialog).toContainText('行政代码长度必须');
	expect(fixture.count('add')).toBe(0);
	fixture.failures.add = 1;
	await fillEditor(dialog, '保留草稿', 'ABCDEF');
	await dialog.getByRole('button', { name: '保存', exact: true }).click();
	await expect(dialog).toContainText('草稿已保留');
	await expect(dialog.getByLabel('行政名称', { exact: true })).toHaveValue('保留草稿');
	const held = gate();
	fixture.holds.set('add', held.promise);
	try {
		await fillEditor(dialog, '重试区域', 'ABCDEF');
		await dialog.getByRole('button', { name: '保存', exact: true }).click();
		await expect.poll(() => fixture.count('add')).toBe(2);
		await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
		await expect(dialog.getByLabel('行政名称', { exact: true })).toBeDisabled();
		expect(fixture.count('add')).toBe(2);
	} finally {
		held.release();
		fixture.holds.delete('add');
	}
	await expect(dialog).toHaveCount(0);
	await expect(row(page, '重试区域')).toHaveCount(1);
});

test('删除取消不请求，确认明确级联且选中节点被删除后回根节点', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await select(page, '四川省');
	await row(page, '四川省').getByRole('button', { name: '删除', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '删除行政区域', exact: true });
	await expect(dialog).toContainText('及其所有子孙区域');
	await dialog.getByRole('button', { name: '取消', exact: true }).click();
	expect(fixture.count('delete')).toBe(0);
	await row(page, '四川省').getByRole('button', { name: '删除', exact: true }).click();
	await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(row(page, '北京市')).toHaveCount(1);
	expect(fixture.records().map((record) => record.name)).toEqual(['北京市']);
	expect(fixture.last('delete')?.body).toEqual({ id: rootId });
	await expect.poll(() => fixture.last('page')?.body.pid).toBe(0);
	await expect(page.getByRole('tree', { name: '区域导航', exact: true }).getByText('四川省', { exact: true })).toHaveCount(0);
});

test('删除失败仍可取消和重试，忙时不会重复发送', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	fixture.failures.delete = 1;
	await row(page, '北京市').getByRole('button', { name: '删除', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '删除行政区域', exact: true });
	await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
	await expect(dialog).toContainText('删除失败');
	await expect(row(page, '北京市')).toHaveCount(1);
	const held = gate();
	fixture.holds.set('delete', held.promise);
	try {
		await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
		await expect.poll(() => fixture.count('delete')).toBe(2);
		await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
	} finally {
		held.release();
		fixture.holds.delete('delete');
	}
	await expect(dialog).toHaveCount(0);
	await expect(row(page, '北京市')).toHaveCount(0);
});

test('树和分页分别错误重试，以及无数据空态', async ({ page }) => {
	const fixture = await setup(page, { rows: [] });
	fixture.failures.tree = 1;
	fixture.failures.page = 1;
	await open(page);
	await expect(page.getByText('区域树加载失败，请重试。', { exact: true })).toBeVisible();
	await expect(page.getByText('区域列表加载失败，请重试。', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: '刷新区域树', exact: true }).click();
	await page.getByRole('button', { name: '刷新区域列表', exact: true }).click();
	await expect(list(page).getByText('暂无行政区域', { exact: true })).toBeVisible();
	await expect(page.getByText('区域树加载失败，请重试。', { exact: true })).toHaveCount(0);
});

test('切换条件取消上一请求并拒绝迟到列表覆盖', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await expect(row(page, '四川省')).toHaveCount(1);
	const held = gate();
	fixture.holds.set('page', held.promise);
	try {
		await page.getByRole('button', { name: '刷新区域列表', exact: true }).click();
		await expect.poll(() => fixture.count('page')).toBe(2);
		fixture.holds.delete('page');
		await select(page, '成都市');
		await expect(row(page, '四川省')).toHaveCount(0);
		await expect(row(page, '锦江区')).toHaveCount(1);
	} finally {
		held.release();
		fixture.holds.delete('page');
	}
	await expect(row(page, '四川省')).toHaveCount(0);
	await expect(row(page, '成都市')).toHaveCount(1);
});

test('KeepAlive 离页释放树、列表和写请求，迟到保存不触发刷新', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await expect(row(page, '四川省')).toHaveCount(1);
	const held = gate();
	const aborted: string[] = [];
	page.on('requestfailed', (request) => {
		if (request.url().includes('/api/sysRegion/')) aborted.push(request.url());
	});
	fixture.holds.set('tree', held.promise);
	fixture.holds.set('page', held.promise);
	fixture.holds.set('add', held.promise);
	try {
		await page.getByRole('button', { name: '刷新区域树', exact: true }).click();
		await page.getByRole('button', { name: '刷新区域列表', exact: true }).click();
		await page.getByRole('button', { name: '新增区域', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: '添加行政区域', exact: true });
		await fillEditor(dialog, '迟到区域', '123456');
		await dialog.getByRole('button', { name: '保存', exact: true }).click();
		await expect.poll(() => fixture.count('add')).toBe(1);
		await page.evaluate(() => {
			window.location.hash = '/about';
		});
		await expect(page).toHaveURL(/#\/about$/);
		await expect(page.locator('.region-page')).toBeHidden();
		await expect.poll(() => aborted.length).toBe(3);
	} finally {
		held.release();
		fixture.holds.clear();
	}
	await expect(page.getByRole('dialog', { name: '添加行政区域', exact: true })).toHaveCount(0);
	expect(fixture.count('tree')).toBe(2);
	expect(fixture.count('page')).toBe(2);
	await page.evaluate(() => {
		window.location.hash = '/system/region';
	});
	await expect(page.locator('.region-page')).toBeVisible();
	await expect.poll(() => fixture.count('tree')).toBe(3);
	await expect.poll(() => fixture.count('page')).toBe(3);
});

for (const colorScheme of ['light', 'dark'] as const) {
	test(colorScheme + ' 桌面完整区域列表和编辑表单截图', async ({ page }, testInfo) => {
		await setup(page);
		await open(page);
		await expect(row(page, '成都市')).toHaveCount(1);
		if ((await page.locator('html').getAttribute('class'))?.includes('dark') !== (colorScheme === 'dark')) await page.getByRole('button', { name: colorScheme, exact: true }).click();
		await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(colorScheme === 'dark');
		await page.getByRole('button', { name: '全部展开', exact: true }).click();
		await settleVisual(page);
		await page.screenshot({ path: testInfo.outputPath('region-table-' + colorScheme + '.png'), fullPage: true });
		await row(page, '成都市').getByRole('button', { name: '编辑', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: '编辑行政区域', exact: true });
		await expect(dialog.getByLabel('备注', { exact: true })).toHaveValue(originalCity.remark!);
		await settleVisual(page);
		await page.screenshot({ path: testInfo.outputPath('region-editor-' + colorScheme + '.png'), fullPage: true });
	});
}
