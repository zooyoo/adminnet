import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import HomeEntry from './index.vue';
const { store, access, boundary, events } = vi.hoisted(() => ({ store: { value: null as any }, access: { value: null as any }, boundary: { version: 0 }, events: [] as string[] }));
vi.mock('@vben/stores', () => ({ useUserStore: () => store.value, useAccessStore: () => access.value }));
vi.mock('#/api/session', () => ({ sessionBoundary: boundary }));
vi.mock('./workbench-content.vue', async () => { const { onMounted, onUnmounted } = await import('vue'); return { default: { setup() { onMounted(() => events.push('mounted')); onUnmounted(() => events.push('unmounted')); return {}; }, template: '<div class="workbench-content">内容</div>' } }; });
beforeEach(() => { events.splice(0); boundary.version=0;store.value=reactive({userInfo:{userId:'u1',tenantId:'a',currentTenantId:'a',realName:'初始名字'}}); access.value=reactive({accessToken:'token-a'}); });
describe('工作台入口身份代次',()=>{
 it('初始身份就绪仅挂载一次并把原内容保持为一个独立组件',async()=>{const wrapper=mount(HomeEntry);await flushPromises();expect(wrapper.findAll('.workbench-content')).toHaveLength(1);expect(wrapper.get('[data-workbench-identity]').attributes('data-workbench-identity')).toBe('0:u1:a');expect(events).toEqual(['mounted']);wrapper.unmount();});
 it('A到B再回A按当前代次重挂原内容，旧实例先卸载',async()=>{const wrapper=mount(HomeEntry);await flushPromises();boundary.version=1;store.value.userInfo={...store.value.userInfo,currentTenantId:'b'};await flushPromises();expect(wrapper.get('[data-workbench-identity]').attributes('data-workbench-identity')).toBe('1:u1:b');boundary.version=2;store.value.userInfo={...store.value.userInfo,currentTenantId:'a'};await flushPromises();expect(wrapper.get('[data-workbench-identity]').attributes('data-workbench-identity')).toBe('2:u1:a');expect(events).toEqual(['mounted','unmounted','mounted','unmounted','mounted']);wrapper.unmount();});
 it('候选身份未采纳和仅资料刷新不卸载原内容',async()=>{const wrapper=mount(HomeEntry);await flushPromises();store.value.userInfo={...store.value.userInfo,realName:'更新名字'};await flushPromises();expect(wrapper.get('[data-workbench-identity]').attributes('data-workbench-identity')).toBe('0:u1:a');expect(events).toEqual(['mounted']);wrapper.unmount();});
 it('清除token先卸载旧内容，新用户就绪后才重新挂载',async()=>{const wrapper=mount(HomeEntry);await flushPromises();boundary.version=1;access.value.accessToken='';store.value.userInfo=null;await flushPromises();expect(wrapper.find('.workbench-content').exists()).toBe(false);access.value.accessToken='token-b';store.value.userInfo={userId:'u2',tenantId:'b',currentTenantId:'b'};await flushPromises();expect(wrapper.get('[data-workbench-identity]').attributes('data-workbench-identity')).toBe('1:u2:b');expect(events).toEqual(['mounted','unmounted','mounted']);wrapper.unmount();});
});
