import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionBoundary } from '#/api/session';

import Preview from './index.vue';

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock('#/api/system/file', () => ({ readFile }));
vi.mock('antdv-next', () => ({
	Modal: { props: ['open', 'title'], template: '<section v-if="open"><slot /></section>' },
	Alert: { props: ['message'], template: '<p role="alert">{{ message }}</p>' },
	Spin: { template: '<span>加载中</span>' },
}));
vi.mock('@vue-office/docx', () => ({ default: { template: '<div>文档</div>' } }));
vi.mock('@vue-office/excel', () => ({ default: { template: '<div>工作簿</div>' } }));
vi.mock('@vue-office/pdf', () => ({ default: { template: '<div>PDF</div>' } }));

describe('预览取消和资源生命周期', () => {
	beforeEach(() => {
		readFile.mockReset();
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test-file'), revokeObjectURL: vi.fn() }));
	});
	it('关闭时取消读取，迟到结果不生成 URL', async () => {
		let resolve!: (value: unknown) => void;
		readFile.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			})
		);
		const wrapper = mount(Preview);
		const pending = wrapper.vm.show({ id: 1, suffix: '.png', fileName: '图片' });
		const signal = readFile.mock.calls[0]![1];
		wrapper.vm.close();
		resolve({ blob: new Blob(['image']), fileName: 'image.png' });
		await pending;
		expect(signal.aborted).toBe(true);
		expect(URL.createObjectURL).not.toHaveBeenCalled();
		wrapper.unmount();
	});
	it('切换和卸载都释放已生成的 URL', async () => {
		readFile.mockResolvedValue({ blob: new Blob(['image']), fileName: 'image.png' });
		const wrapper = mount(Preview);
		await wrapper.vm.show({ id: 1, suffix: '.png' });
		expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
		await wrapper.vm.show({ id: 2, suffix: '.png' });
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
		wrapper.unmount();
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
	});
	it('离开缓存页面也释放预览资源', async () => {
		readFile.mockResolvedValue({ blob: new Blob(['image']), fileName: 'image.png' });
		const visible = ref(true);
		const host = mount(defineComponent({ setup: () => () => h(KeepAlive, {}, { default: () => visible.value ? h(Preview) : undefined }) }));
		const preview = host.findComponent(Preview);
		await preview.vm.show({ id: 1, suffix: '.png' });
		visible.value = false;
		await nextTick();
		expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		visible.value = true;
		await nextTick();
		expect(host.find('img').exists()).toBe(false);
		host.unmount();
	});
	it('身份变化立即关闭并释放已有预览', async () => {
		readFile.mockResolvedValue({ blob: new Blob(['image']), fileName: 'image.png' });
		const wrapper = mount(Preview);
		await wrapper.vm.show({ id: 1, suffix: '.png' });
		sessionBoundary.invalidate();
		await flushPromises();
		expect(wrapper.find('img').exists()).toBe(false);
		expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		wrapper.unmount();
	});
	it('未知类型不请求文件，读取失败显示可恢复错误', async () => {
		const wrapper = mount(Preview);
		await wrapper.vm.show({ id: 1, suffix: '.txt' });
		expect(readFile).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain('不支持预览');
		readFile.mockRejectedValue(new Error('denied'));
		await wrapper.vm.show({ id: 2, suffix: '.png' });
		expect(wrapper.text()).toContain('文件加载失败');
		wrapper.unmount();
	});
});
