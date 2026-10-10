import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const testToken = (tenant = 1) => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600, tenant })).toString('base64url')}.signature`;

type AdminModule = 'user' | 'tenant' | 'dict' | 'config' | 'tenantConfig' | 'lang' | 'langText' | 'infoSetting' | 'cache' | 'userRegWay' | 'onlineUser' | 'notice' | 'ldap' | 'file' | 'job' | 'database' | 'openAccess' | 'region' | 'stressTest' | 'update';
const titles: Record<AdminModule, string> = {
	user: '用户管理',
	tenant: '租户管理',
	dict: '字典管理',
	config: '系统参数',
	tenantConfig: '租户参数',
	lang: '语言管理',
	langText: '翻译管理',
	infoSetting: '系统信息配置',
	cache: '缓存管理',
	userRegWay: '注册方案',
	onlineUser: '在线用户',
	notice: '通知公告',
	ldap: 'AD域配置',
	file: '文件管理',
	job: '任务调度',
	database: '库表管理',
	stressTest: '受控接口压测',
	update: '系统更新',
	openAccess: '开放接口身份',
	region: '区域管理',
};
export async function mockAdminSession(page: Page, module: AdminModule, options: { readOnly?: boolean; superAdmin?: boolean; updateActions?: string[]; updateMenuPath?: '/platform/update'; openAccessActions?: ('add' | 'delete' | 'page' | 'update')[]; openAccessMenuPath?: '/platform/openAccess'; regionActions?: ('add' | 'delete' | 'page' | 'update')[]; regionMenuPath?: '/platform/region' } = {}) {
	await page.route('**/prod-api/hubs/onlineUser/negotiate*', (route) => route.fulfill({ status: 503, json: { message: 'Contract fixture: real-time service unavailable' } }));
	await page.route('**/prod-api/api/sysNotice/unReadList', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	const prefix = module === 'stressTest' ? 'sysCommon' : `sys${module[0]!.toUpperCase()}${module.slice(1)}`;
	const actions = module === 'region'
		? options.regionActions ?? (options.readOnly ? ['page'] : ['page', 'add', 'update', 'delete'])
		: module === 'openAccess'
		? options.openAccessActions ?? (options.readOnly ? ['page'] : ['page', 'add', 'update', 'delete'])
		: module === 'update'
		? options.updateActions ?? (options.readOnly ? ['list', 'logs'] : ['list', 'logs', 'update', 'restore', 'clear', 'webHookKey'])
		: module === 'stressTest'
		? options.readOnly ? [] : ['stressTest']
		: module === 'database'
		? options.readOnly ? ['list', 'tableList', 'columnList', 'dbTypeList', 'visualDbTable'] : ['list', 'tableList', 'columnList', 'dbTypeList', 'addTable', 'updateTable', 'addColumn', 'updateColumn', 'deleteColumn', 'moveColumn', 'deleteTable', 'visualDbTable', 'createEntity', 'createSeedData']
		: module === 'job'
		? options.readOnly ? ['pageJobDetail', 'listJobGroup'] : ['pageJobDetail', 'listJobGroup', 'addJobDetail', 'updateJobDetail', 'deleteJobDetail', 'runJob', 'pauseJob', 'startJob', 'cancelJob', 'addJobTrigger', 'updateJobTrigger', 'deleteJobTrigger', 'pauseTrigger', 'startTrigger', 'pageJobTriggerRecord', 'jobClusterList', 'startAllJob', 'pauseAllJob', 'cancelSleep', 'persistAll', 'clearJobTriggerRecord']
		: options.readOnly
		? ['page', 'list']
		: [
				'page',
				'list',
				'keyList',
				'value',
				'clear',
				'add',
				'update',
				'delete',
				'batchDelete',
				'export',
				'import',
				'setStatus',
				'resetPwd',
				'unlockLogin',
				'grantMenu',
				'createDb',
				'goTenant',
				'changeTenant',
				'syncGrantMenu',
				'forceOffline',
				'public',
				'detail',
				'syncUser',
				'syncOrg',
				'uploadFile',
				'downloadFile',
			];
	await page.route('**/prod-api/api/sysConfig/sysInfo', (route) =>
		route.fulfill({ json: { code: 200, result: { title: 'Admin.NET', captcha: 2, secondVer: 2, hideTenantForLogin: true, enableReg: 2 } } })
	);
	await page.route('**/prod-api/api/sysAuth/login', (route) =>
		route.fulfill({ json: { code: 200, result: { accessToken: testToken(), refreshToken: 'refresh-one', homepage: `/system/${module}` } } })
	);
	await page.route('**/prod-api/api/sysAuth/userInfo', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: {
					id: 10,
					account: 'contract',
					realName: '测试用户',
					accountType: options.superAdmin ? 999 : 777,
					tenantId: 1,
					currentTenantId: 1,
					roleIds: [1],
					buttons: module === 'infoSetting' ? (options.readOnly ? [] : ['sysConfig:saveSysInfo']) : module === 'dict' ? ['sysDictType', 'sysDictData'].flatMap((code) => actions.map((action) => `${code}:${action}`)) : actions.map((action) => `${prefix}:${action}`),
				},
			},
		})
	);
	await page.route('**/prod-api/api/sysMenu/vbenMenuTree', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: [{ name: prefix, path: module === 'region' ? options.regionMenuPath ?? '/system/region' : module === 'update' ? options.updateMenuPath ?? '/system/update' : module === 'openAccess' ? options.openAccessMenuPath ?? '/system/openAccess' : `/system/${module}`, component: `/system/${module}/index`, meta: { title: titles[module], icon: 'lucide:users', ...((module === 'update' || module === 'openAccess' || module === 'region') ? { keepAlive: true } : {}) } }],
			},
		})
	);
	await page.route('**/prod-api/api/sysTenant/list', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: [
					{ label: '租户一', value: 1, host: '' },
					{ label: '租户二', value: 2, host: '' },
				],
			},
		})
	);
	await page.route('**/prod-api/api/sysDictType/allDictList', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: {
					AccountTypeEnum: [
						{ label: '会员', value: '666' },
						{ label: '普通账号', value: '777' },
						{ label: '系统管理员', value: '888' },
						{ label: '超级管理员', value: '999' },
					],
					CardTypeEnum: [{ label: '身份证', value: 0 }],
					GenderEnum: [
						{ label: '男', value: 1 },
						{ label: '女', value: 2 },
					],
					CultureLevelEnum: [{ label: '本科', value: 5 }],
					NationEnum: [{ label: '汉族', value: '1' }],
				},
			},
		})
	);
}

export async function loginAdmin(page: Page, module: AdminModule) {
	await page.goto('/#/auth/login', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('button[type=submit]')).toBeEnabled();
	await page.getByLabel('账号', { exact: true }).fill('contract');
	await page.getByLabel('密码', { exact: true }).fill('contract-password');
	await expect(page.getByLabel('账号', { exact: true })).toHaveValue('contract');
	await expect(page.getByLabel('密码', { exact: true })).toHaveValue('contract-password');
	await expect(page.locator('button[type=submit]')).toBeEnabled();
	await page.locator('button[type=submit]').click();
	await expect(page).toHaveURL(new RegExp(`#\\/system\\/${module}$`));
}
