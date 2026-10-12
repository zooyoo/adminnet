import type { GeneratedApi, GeneratedField, GeneratedSchema } from './generated';

import { describe, expect, it, vi } from 'vitest';

import { sessionBoundary } from '#/api/session';

import { createGeneratedSession, generatedKeys, generatedLabel, generatedOptions, generatedRowKey, generatedRules, generatedValue } from './generated';

vi.mock('#/api/request', () => ({ requestClient: { get: vi.fn(async () => [{ value: '1', name: 'Enable', describe: '启用' }]) } }));
const field = (extra: Partial<GeneratedField> = {}): GeneratedField => ({ key: 'name', title: '名称', effectType: 'Input', netType: 'string', required: true, query: true, table: true, editable: true, retract: false, sortable: false, maxLength: 4, isStatus: false, ...extra });
const schema = (fields: GeneratedField[] = [field()]): GeneratedSchema => ({ title: '测试', permission: 'probe', primaryKeys: ['id', 'code'], fields, defaults: {}, importable: false });
const api: GeneratedApi = { page: async () => ({ items: [], total: 0 }), detail: async () => ({}), add: async () => {}, update: async () => {}, delete: async () => {}, batchDelete: async () => {} };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }

describe('生成页面契约', () => {
 it('组合主键保持值和类型，避免单主键或分隔符冲突', () => {
  expect(generatedKeys(schema(), { id: 1, code: 'a|b', name: '不发送' })).toEqual({ id: 1, code: 'a|b' });
  expect(generatedRowKey(schema(), { id: 1, code: 'a|b' })).not.toBe(generatedRowKey(schema(), { id: '1', code: 'a|b' }));
 });
 it('必填保留 0 和 false，长度校验不改写草稿', () => {
  const values = { name: 'abcde' };
  expect(generatedRules(schema(), values)).toContain('4');
  expect(values.name).toBe('abcde');
  expect(generatedRules(schema(), { name: 0 })).toBe('');
  expect(generatedRules(schema(), { name: false })).toBe('');
  expect(generatedRules(schema(), { name: '' })).toContain('请填写');
 });
 it('数值、枚举、布尔和空查询按真实类型归一', () => {
  expect(generatedValue(field({ netType: 'StatusEnum' }), '1')).toBe(1);
  expect(generatedValue(field({ netType: 'long?' }), '42')).toBe(42);
  expect(generatedValue(field({ netType: 'decimal' }), 'oops')).toBeUndefined();
  expect(generatedValue(field({ netType: 'bool' }), 'false')).toBe(false);
  expect(generatedValue(field(), '')).toBeUndefined();
 });
 it('枚举与外键树选项归一，标签递归匹配', async () => {
  const fields = [field({ effectType: 'EnumSelector', netType: 'StatusEnum', dictTypeCode: 'StatusEnum' }), field({ key: 'pid', effectType: 'ApiTreeSelector', netType: 'long' })];
  const options = await generatedOptions(schema(fields), { ...api, dropdown: async () => ({ pid: [{ value: '1', label: '父', children: [{ value: '2', label: '子' }] }] }) }, false, new AbortController().signal);
  expect(options.name).toEqual([{ value: 1, label: '启用', children: [] }]);
  expect(generatedLabel(options.pid!, 2)).toBe('子');
 });
});

describe('生成页面请求边界', () => {
 it('关闭中止实际请求并拒绝迟到成功', async () => {
  const session = createGeneratedSession(); const response = deferred<number>(); let signal!: AbortSignal;
  const result = session.run((value) => { signal = value; return response.promise; });
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  session.clear(); expect(signal.aborted).toBe(true); response.resolve(1); await rejected;
 });
 it('关闭后的服务端迟到失败按取消处理，不污染新页错误', async () => {
  const session = createGeneratedSession(); const response = deferred<number>();
  const result = session.run(() => response.promise); const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  session.clear(); response.reject(new Error('旧页服务失败')); await rejected;
  await expect(session.run(async () => 2)).resolves.toBe(2);
 });
 it('身份切换中止请求并拒绝旧身份回执', async () => {
  const session = createGeneratedSession(); const response = deferred<number>();
  const result = session.run(() => response.promise); const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  sessionBoundary.invalidate(); response.resolve(1); await rejected;
 });
 it('外部取消信号透传，当前真实失败仍供草稿重试显示', async () => {
  const session = createGeneratedSession(); const controller = new AbortController(); const response = deferred<number>();
  const result = session.run(() => response.promise, controller.signal); const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); response.resolve(1); await rejected;
  await expect(session.run(async () => { throw new Error('当前保存失败'); })).rejects.toThrow('当前保存失败');
 });
});
