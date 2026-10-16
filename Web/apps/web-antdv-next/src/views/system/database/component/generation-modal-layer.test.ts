import { flushPromises, mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { ConfigProvider } from 'antdv-next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GenerationEditor from './generation-editor.vue';
vi.mock('#/api/session', () => ({ sessionBoundary: { version: 0, track: () => undefined, release: () => undefined } }));
vi.mock('#/api/system/database', () => ({
	databaseGeneration: {
		options: async () => ({ namespaces: ['Admin.NET.Core'], baseClasses: ['EntityBaseId'] }),
		previewEntity: async () => ({ relativePath: 'Admin.NET.Core/Entity/Owned.cs', content: 'owned', hash: 'h', fileExists: false }),
	},
}));
const instances: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const instance of instances.splice(0)) instance.unmount();
	document.body.innerHTML = '';
});
describe('生成确认层级跟随公开主题token', () => {
	for (const popup of [1000, 3000])
		it('token ' + popup + ' 下确认层总比主层高1', async () => {
			const wrapper = mount(ConfigProvider, {
				props: { theme: { token: { zIndexPopupBase: popup } } },
				slots: { default: () => h(GenerationEditor, { open: true, kind: 'entity', target: { configId: 'owned', tableName: 'Owned' }, connectionTitle: 'owned' }) },
				attachTo: document.body,
			});
			instances.push(wrapper);
			await flushPromises();
			await nextTick();
			const preview = [...document.querySelectorAll<HTMLButtonElement>('.generation-actions button')].find((button) => button.textContent?.includes('预览代码'))!;
			preview.click();
			await flushPromises();
			await nextTick();
			const write = [...document.querySelectorAll<HTMLButtonElement>('.generation-actions button')].find((button) => button.textContent?.includes('生成文件'))!;
			write.click();
			await flushPromises();
			await nextTick();
			const levels = [...document.querySelectorAll<HTMLElement>('.ant-modal-wrap')]
				.filter((element) => element.querySelector('.ant-modal-title'))
				.map((element) => ({ title: element.querySelector('.ant-modal-title')!.textContent, z: Number(getComputedStyle(element).zIndex) }));
			expect(levels.find((item) => item.title === '生成实体')?.z).toBe(popup);
			expect(levels.find((item) => item.title === '确认生成文件')?.z).toBe(popup + 1);
		});
});
