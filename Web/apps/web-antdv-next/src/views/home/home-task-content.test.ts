import { flushPromises, mount } from '@vue/test-utils';

import { afterEach, describe, expect, it, vi } from 'vitest';

import Content from './workbench-content.vue';
const { push, fetchPublic } = vi.hoisted(() => ({ push: vi.fn(), fetchPublic: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@vben/stores', () => ({ useUserStore: () => ({ userInfo: { userId: 'u1', tenantId: 't1', realName: '测试用户' } }) }));
vi.mock('@vben/preferences', () => ({ preferences: { app: { name: '测试工作台' } } }));
vi.mock('#/api/session', () => ({ sessionBoundary: { version: 0 } }));
vi.mock('#/api/system/home', () => ({
	getAvailableMenus: async () => [{ id: 1, status: 1, type: 2, name: 'frame', path: '/actual-menu', meta: { title: '内嵌入口', isIframe: true } }],
	getFavoriteMenus: async () => [{ id: 1 }], saveFavoriteMenus: vi.fn(),
}));
vi.mock('./schedule.vue', () => ({ default: { template: '<div />' } }));
vi.mock('antdv-next', () => ({
	Alert: { template: '<div />' }, Button: { template: '<button><slot /></button>' }, Card: { template: '<div><slot /></div>' },
	CheckboxGroup: { template: '<div />' }, Modal: { template: '<div />' }, Select: { template: '<div />' },
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('HEAD 工作台上的独立任务行为', () => {
	it('挂载即加载公开更新记录，iframe 菜单按实际菜单路径导航', async () => {
		fetchPublic.mockResolvedValue({ ok: true, json: async () => [] });
		vi.stubGlobal('fetch', fetchPublic);
		const wrapper = mount(Content);
		try {
			await flushPromises();
			expect(fetchPublic).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/commits?'), expect.objectContaining({ credentials: 'omit', signal: expect.any(AbortSignal) }));
			const entry = wrapper.findAll('button').find((item) => item.text() === '内嵌入口');
			expect(entry).toBeDefined();
			await entry!.trigger('click');
			expect(push).toHaveBeenCalledExactlyOnceWith('/actual-menu');
		} finally { wrapper.unmount(); }
	});
});
