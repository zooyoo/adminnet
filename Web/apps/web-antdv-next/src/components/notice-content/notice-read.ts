import type { InjectionKey } from 'vue';

export const noticeReadKey: InjectionKey<() => void> = Symbol('noticeRead');
