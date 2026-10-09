import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const job = { id: 21, jobId: 'contract-http', createType: 2, groupName: 'contract', properties: JSON.stringify({ retained: true, HttpJob: JSON.stringify({ RequestUri: 'http://127.0.0.1:1/task', HttpMethod: { Method: 'GET' }, Timeout: 7000, EnsureSuccessStatusCode: false }) }) };
const period = { id: 22, jobId: job.jobId, triggerId: 'contract-period', triggerType: 'Furion.Schedule.PeriodTrigger', assemblyName: 'Furion', args: '60000', status: 3, maxNumberOfRuns: 4, numRetries: 2, retryTimeout: 900, startNow: false };
test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/api/**', (route) => route.fulfill({ status: 404, json: { message: 'Contract fixture: undeclared API' } }));
	await mockAdminSession(page, 'job');
	await page.route('**/prod-api/api/sysJob/pageJobDetail', (route) => route.fulfill({ json: { code: 200, result: { items: [{ jobDetail: job, jobTriggers: [period] }], total: 1 } } }));
	await page.route('**/prod-api/api/sysJob/listJobGroup', (route) => route.fulfill({ json: { code: 200, result: ['contract'] } }));
	await page.route('**/prod-api/api/sysJob/cronPreview', (route) => {
		const data = route.request().postDataJSON();
		return route.fulfill({ json: data.expression === 'invalid' ? { code: 400, message: 'Cron 表达式无效' } : { code: 200, result: { expression: data.expression, format: data.format, fromTime: '2026-10-09 12:00:00', timeZoneId: 'Asia/Shanghai', occurrences: [10, 11, 12, 13, 14].map((day) => `2026-10-${day} 09:00:00`) } } });
	});
});
test('HTTP 编辑保留任务类型与既有参数，拒绝保存仍保留草稿', async ({ page }) => {
	await page.route('**/prod-api/api/sysJob/updateJobDetail', (route) => {
		const data = route.request().postDataJSON();
		expect(data).toMatchObject({ id: 21, jobId: job.jobId, createType: 2, description: '保留草稿' });
		const properties = JSON.parse(data.properties);
		expect(properties.retained).toBe(true);
		expect(JSON.parse(properties.HttpJob)).toMatchObject({ RequestUri: 'http://127.0.0.1:1/task', Timeout: 7000, EnsureSuccessStatusCode: false });
		return route.fulfill({ json: { code: 403, message: '没有任务编辑权限' } });
	});
	await loginAdmin(page, 'job');
	await page.getByRole('button', { name: '编辑任务', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true });
	await expect(dialog.getByLabel('任务编号', { exact: true })).toBeDisabled();
	await expect(dialog.getByRole('combobox', { name: '创建类型', exact: true })).toBeDisabled();
	await dialog.getByLabel('任务描述', { exact: true }).fill('保留草稿');
	await dialog.getByRole('button', { name: '保存任务', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('没有任务编辑权限');
	await expect(dialog.getByLabel('任务描述', { exact: true })).toHaveValue('保留草稿');
	await expect(dialog.getByRole('button', { name: '保存任务', exact: true })).toBeEnabled();
	await expect(page.locator('.ant-message-success')).toHaveCount(0);
});
test('新建校验及取消不会污染下一份草稿', async ({ page }) => {
	await loginAdmin(page, 'job');
	await page.getByRole('button', { name: '新增任务', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '新增任务', exact: true });
	await dialog.getByRole('button', { name: '保存任务', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('任务编号');
	await dialog.getByLabel('任务编号', { exact: true }).fill('unsaved-job');
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await page.getByRole('button', { name: '新增任务', exact: true }).click();
	await expect(dialog.getByLabel('任务编号', { exact: true })).toHaveValue('');
});
test('服务不可达不显示运行成功并保留操作目标', async ({ page }) => {
	await page.route('**/prod-api/api/sysJob/runJob', (route) => route.fulfill({ status: 503, json: { message: '测试调度服务不可达' } }));
	await loginAdmin(page, 'job');
	await page.getByRole('button', { name: '立即运行', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '确认立即运行', exact: true });
	await dialog.getByRole('button', { name: '确认执行', exact: true }).click();
	await expect(dialog.getByRole('alert')).toBeVisible();
	await expect(dialog).toContainText(job.jobId);
	await expect(dialog.getByRole('button', { name: '确认执行', exact: true })).toBeEnabled();
	await expect(page.locator('.ant-message-success')).toHaveCount(0);
});
test('全局批量控制明确作用于全部任务而不是当前查询结果', async ({ page }) => {
	await page.route('**/prod-api/api/sysJob/pauseAllJob', (route) => route.fulfill({ json: { code: 200 } }));
	await loginAdmin(page, 'job');
	await page.getByRole('button', { name: '暂停所有任务', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '确认暂停所有任务', exact: true });
	await expect(dialog).toContainText('不只影响查询结果');
	await dialog.getByRole('button', { name: '确认执行', exact: true }).click();
	await expect(dialog).toBeHidden();
});
test('可视化字段同步、Cron 错误和重新预览', async ({ page }) => {
	await loginAdmin(page, 'job');
	await page.getByRole('button', { name: '触发器', exact: true }).click();
	await page.getByRole('button', { name: '新增触发器', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '新增触发器', exact: true });
	await dialog.getByRole('button', { name: '每天 9 点', exact: true }).click();
	await dialog.getByLabel('Cron 分钟', { exact: true }).fill('15');
	await expect(dialog.getByLabel('Cron 表达式', { exact: true })).toHaveValue('0 15 9 * * *');
	await dialog.getByRole('button', { name: '预览后续 5 次', exact: true }).click();
	await expect(dialog.locator('.cron-preview li')).toHaveCount(5);
	await expect(dialog.locator('.cron-preview')).toContainText('Asia/Shanghai');
	await dialog.getByLabel('Cron 表达式', { exact: true }).fill('invalid');
	await expect(dialog.locator('.cron-preview')).toHaveCount(0);
	await dialog.getByRole('button', { name: '预览后续 5 次', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('Cron 表达式无效');
	await expect(dialog.getByLabel('Cron 表达式', { exact: true })).toHaveValue('invalid');
});
test('非 Cron 触发器编辑保留参数及次数，失败仍可重试', async ({ page }) => {
	await page.route('**/prod-api/api/sysJob/updateJobTrigger', (route) => {
		expect(route.request().postDataJSON()).toMatchObject({ id: 22, jobId: job.jobId, triggerId: period.triggerId, args: '60000', maxNumberOfRuns: 4, numRetries: 2, retryTimeout: 900 });
		return route.fulfill({ json: { code: 400, message: '测试触发器保存失败' } });
	});
	await loginAdmin(page, 'job');
	await page.getByRole('button', { name: '触发器', exact: true }).click();
	await page.getByRole('button', { name: '编辑触发器', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑触发器', exact: true });
	await expect(dialog.getByLabel('触发器参数', { exact: true })).toHaveValue('60000');
	await expect(dialog.getByRole('button', { name: '预览后续 5 次', exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: '保存触发器', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('测试触发器保存失败');
	await expect(dialog.getByLabel('触发器参数', { exact: true })).toHaveValue('60000');
});
test('运行记录和集群加载失败清晰可重试', async ({ page }) => {
	await page.route('**/prod-api/api/sysJob/pageJobTriggerRecord', (route) => route.fulfill({ status: 503, json: { message: '记录服务失败' } }));
	await page.route('**/prod-api/api/sysJob/jobClusterList', (route) => route.fulfill({ json: { code: 400, message: '集群服务失败' } }));
	await loginAdmin(page, 'job');
	await page.getByRole('button', { name: '运行记录', exact: true }).click();
	const records = page.getByRole('dialog', { name: `运行记录 · ${job.jobId}`, exact: true });
	await expect(records.getByRole('alert')).toBeVisible();
	await records.getByRole('button', { name: '关闭', exact: true }).click();
	await page.getByRole('button', { name: '查看集群', exact: true }).click();
	const cluster = page.getByRole('dialog', { name: '任务集群', exact: true });
	await expect(cluster.getByRole('alert')).toContainText('集群服务失败');
	await expect(cluster.getByRole('button', { name: '刷新集群', exact: true })).toBeEnabled();
});
test('只读授权隐藏全部任务与触发器写操作', async ({ page }) => {
	await mockAdminSession(page, 'job', { readOnly: true });
	await loginAdmin(page, 'job');
	for (const name of ['新增任务', '编辑任务', '立即运行', '删除任务', '暂停所有任务', '查看集群']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: '触发器', exact: true }).click();
	for (const name of ['新增触发器', '编辑触发器', '删除触发器', '启动触发器']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
});
test('原看板使用同源根路径，不携带应用令牌或业务 API 前缀', async ({ page }) => {
	await page.route('**/schedule/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated dashboard contract</title>' }));
	await loginAdmin(page, 'job');
	await page.getByRole('button', { name: '打开独立调度看板', exact: true }).click();
	await expect(page.locator('iframe[title="独立调度看板"]')).toHaveAttribute('src', '/schedule/');
	await expect(page.getByRole('link', { name: '在新窗口打开调度看板', exact: true })).toHaveAttribute('href', '/schedule/');
});
test('内置任务只编辑既有配置，不变更编号或创建类型', async ({ page }) => {
	const builtIn = { ...job, createType: 0, jobId: 'existing-built-in', properties: '{"preserved":true}' };
	await page.route('**/prod-api/api/sysJob/pageJobDetail', (route) => route.fulfill({ json: { code: 200, result: { items: [{ jobDetail: builtIn, jobTriggers: [] }], total: 1 } } }));
	await page.route('**/prod-api/api/sysJob/updateJobDetail', (route) => {
		expect(route.request().postDataJSON()).toMatchObject({ jobId: builtIn.jobId, createType: 0, properties: builtIn.properties });
		return route.fulfill({ json: { code: 200 } });
	});
	await loginAdmin(page, 'job');
	await expect(page.locator('.job-page tbody')).toContainText('内置');
	await page.getByRole('button', { name: '编辑任务', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true });
	await expect(dialog.getByLabel('任务编号', { exact: true })).toBeDisabled();
	await expect(dialog.getByRole('combobox', { name: '创建类型', exact: true })).toBeDisabled();
	await expect(dialog.getByLabel('HTTP 地址', { exact: true })).toHaveCount(0);
	await dialog.getByLabel('任务描述', { exact: true }).fill('内置任务描述');
	await dialog.getByRole('button', { name: '保存任务', exact: true }).click();
	await expect(dialog).toBeHidden();
});
