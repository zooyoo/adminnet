import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionBoundary } from '#/api/session';

import Server from './index.vue';

const { hardware, runtime, packages } = vi.hoisted(() => ({ hardware: vi.fn(), runtime: vi.fn(), packages: vi.fn() }));
vi.mock('#/api/system/server', () => ({ serverHardware: hardware, serverRuntime: runtime, serverPackages: packages }));
vi.mock('@vben/access', () => ({ useAccess: () => ({ hasAccessByCodes: () => granted.value }) }));
vi.mock('@vben/icons', () => ({ createIconifyIcon: () => ({ template: '<i />' }) }));
vi.mock('antdv-next', () => ({
	Alert: { props: ['title'], template: '<p role="alert">{{ title }}</p>' },
	Button: { template: '<button><slot /></button>' },
	Card: { props: ['title'], template: '<section><h2>{{ title }}</h2><slot /></section>' },
	Spin: { template: '<div><slot /></div>' },
	Switch: { template: '<button />' },
	Tag: { template: '<span><slot /></span>' },
	Empty: { props: ['description'], template: '<p>{{ description }}</p>', PRESENTED_IMAGE_SIMPLE: 'empty' },
	Progress: { props: ['percent'], template: '<p>{{ percent }}%</p>' },
}));

const granted = ref(true);
describe('服务器监控状态与轮询', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		granted.value = true;
		hardware.mockReset().mockResolvedValue({ cpuInfo: { usagePercentage: null }, ramInfo: { totalBytes: 0 }, diskInfos: [] });
		runtime.mockReset().mockResolvedValue({ runtimeInfo: { machineName: 'isolated-host' } });
		packages.mockReset().mockResolvedValue([]);
	});
	afterEach(() => {
		vi.useRealTimers();
	});
	it('GPU 采集失败明确提示，依赖名称与版本同时可读', async () => {
		hardware.mockResolvedValue({ gpuInfos: [{ name: 'Error', description: 'Failed to retrieve GPU information' }] });
		packages.mockResolvedValue([{ packageName: 'Furion', packageVersion: '4.9.9.92' }]);
		const wrapper = mount(Server);
		await flushPromises();
		expect(wrapper.text()).toContain('GPU 采集失败');
		expect(wrapper.find('.package-list').text()).toContain('Furion');
		expect(wrapper.find('.package-list').text()).toContain('4.9.9.92');
		wrapper.unmount();
	});
	it('空值显示未提供，接口失败保留最近成功数据', async () => {
		const wrapper = mount(Server);
		await flushPromises();
		expect(wrapper.text()).toContain('isolated-host');
		expect(wrapper.text()).toContain('CPU 使用率未提供');
		expect(wrapper.text()).toContain('内存使用率未提供');
		hardware.mockRejectedValue(new Error('hardware unavailable'));
		await (wrapper.vm as unknown as { refresh: (includePackages?: boolean) => Promise<void> }).refresh(true);
		await flushPromises();
		expect(wrapper.text()).toContain('hardware unavailable');
		expect(wrapper.text()).toContain('isolated-host');
		wrapper.unmount();
	});
	it('缓存失活取消请求与轮询，重新激活只恢复一次刷新', async () => {
		const visible = ref(true);
		const host = mount(defineComponent({ setup: () => () => h(KeepAlive, {}, { default: () => (visible.value ? h(Server) : undefined) }) }));
		await flushPromises();
		expect(hardware).toHaveBeenCalledTimes(1);
		const signal = hardware.mock.calls[0]![0];
		visible.value = false;
		await nextTick();
		expect(signal.aborted).toBe(true);
		await vi.advanceTimersByTimeAsync(20000);
		expect(hardware).toHaveBeenCalledTimes(1);
		visible.value = true;
		await nextTick();
		await flushPromises();
		expect(hardware).toHaveBeenCalledTimes(2);
		host.unmount();
		await vi.advanceTimersByTimeAsync(20000);
		expect(hardware).toHaveBeenCalledTimes(2);
	});
	it('身份变化拒绝迟到结果并停止自动刷新', async () => {
		let finish!: (value: unknown) => void;
		runtime.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			})
		);
		const wrapper = mount(Server);
		const signal = runtime.mock.calls[0]![0];
		sessionBoundary.invalidate();
		finish({ runtimeInfo: { machineName: 'old-identity-host' } });
		await flushPromises();
		expect(signal.aborted).toBe(true);
		expect(wrapper.text()).not.toContain('old-identity-host');
		await vi.advanceTimersByTimeAsync(20000);
		expect(runtime).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});
	it('身份变化立即清除已加载的旧服务读数', async () => {
		const wrapper = mount(Server);
		await flushPromises();
		expect(wrapper.text()).toContain('isolated-host');
		sessionBoundary.invalidate();
		await nextTick();
		expect(wrapper.text()).not.toContain('isolated-host');
		await vi.advanceTimersByTimeAsync(20000);
		expect(runtime).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});
	it('失活期间权限恢复不重启隐藏页面轮询', async () => {
		const visible = ref(true);
		const host = mount(defineComponent({ setup: () => () => h(KeepAlive, {}, { default: () => (visible.value ? h(Server) : undefined) }) }));
		await flushPromises();
		visible.value = false;
		await nextTick();
		granted.value = false;
		await nextTick();
		granted.value = true;
		await nextTick();
		await vi.advanceTimersByTimeAsync(20000);
		expect(hardware).toHaveBeenCalledTimes(1);
		visible.value = true;
		await nextTick();
		await flushPromises();
		expect(hardware).toHaveBeenCalledTimes(2);
		host.unmount();
	});
});
