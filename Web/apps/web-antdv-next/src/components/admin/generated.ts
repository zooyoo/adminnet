import type { AxiosResponse } from 'axios';

import { requestClient } from '#/api/request';
import { sessionBoundary } from '#/api/session';

export type GeneratedRow = Record<string, unknown>;
export interface GeneratedOption { label: string; value: number | string; children?: GeneratedOption[]; }
export interface GeneratedField {
 key: string; title: string; effectType: string; netType: string; dictTypeCode?: null | string;
 required: boolean; query: boolean; queryType?: null | string; retract: boolean;
 table: boolean; editable: boolean; sortable: boolean; maxLength: number; extendedKey?: string; isStatus: boolean;
}
export interface GeneratedSchema {
 title: string; permission: string; primaryKeys: string[]; fields: GeneratedField[];
 defaults: GeneratedRow; importable: boolean; printType?: null | string; printName?: null | string;
}
export interface GeneratedApi {
 page: (query: GeneratedRow, signal: AbortSignal) => Promise<{ items: GeneratedRow[]; total: number }>;
 detail: (keys: GeneratedRow, signal: AbortSignal) => Promise<GeneratedRow>;
 add: (values: GeneratedRow, signal: AbortSignal) => Promise<unknown>;
 update: (values: GeneratedRow, signal: AbortSignal) => Promise<unknown>;
 delete: (keys: GeneratedRow, signal: AbortSignal) => Promise<unknown>;
 batchDelete: (keys: GeneratedRow[], signal: AbortSignal) => Promise<unknown>;
 dropdown?: (fromPage: boolean, signal: AbortSignal) => Promise<GeneratedRow>;
 setStatus?: (values: GeneratedRow, signal: AbortSignal) => Promise<unknown>;
 export?: (query: GeneratedRow, signal: AbortSignal) => Promise<AxiosResponse<ArrayBuffer>>;
 import?: (file: File, signal: AbortSignal) => Promise<AxiosResponse<ArrayBuffer>>;
 downloadTemplate?: (signal: AbortSignal) => Promise<AxiosResponse<ArrayBuffer>>;
 upload?: (field: string, file: File, signal: AbortSignal) => Promise<{ url?: null | string }>;
}

export function generatedKeys(schema: GeneratedSchema, row: GeneratedRow): GeneratedRow {
 return Object.fromEntries(schema.primaryKeys.map((key) => [key, row[key]]));
}
export function generatedRowKey(schema: GeneratedSchema, row: GeneratedRow): string {
 return JSON.stringify(schema.primaryKeys.map((key) => row[key]));
}
export function generatedValue(field: GeneratedField, value: unknown): unknown {
 if (value === '' || value === undefined || value === null) return undefined;
 if (field.netType.replace(/\?$/, '') === 'bool') return value === true || value === 'true';
 if (/^(?:byte|sbyte|short|ushort|int|uint|long|ulong|float|double|decimal|\w+Enum)\??$/.test(field.netType)) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
 }
 return value;
}
export function generatedRules(schema: GeneratedSchema, values: GeneratedRow): string {
 for (const field of schema.fields.filter((item) => item.editable)) {
  const value = values[field.key];
  if (field.required && (value === undefined || value === null || value === '')) return `请填写${field.title}`;
  if (field.maxLength > 0 && typeof value === 'string' && value.length > field.maxLength) return `${field.title}不能超过 ${field.maxLength} 个字符`;
 }
 return '';
}

// 生成页面的请求与身份切换、缓存离页共享同一取消边界。
export function createGeneratedSession() {
 const pending = new Set<AbortController>();
 let generation = 0;
 function clear() {
  generation += 1;
  for (const controller of pending) controller.abort();
  pending.clear();
 }
 async function run<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const current = generation;
  const version = sessionBoundary.version;
  pending.add(controller);
  sessionBoundary.track(controller);
  try {
   const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
   const result = await operation(combined);
   combined.throwIfAborted();
   if (current !== generation || version !== sessionBoundary.version) throw new DOMException('View closed', 'AbortError');
   return result;
  } catch (cause) {
   if (controller.signal.aborted || signal?.aborted || current !== generation || version !== sessionBoundary.version) throw new DOMException('View closed', 'AbortError');
   throw cause;
  } finally {
   pending.delete(controller);
   sessionBoundary.release(controller);
  }
 }
 return { clear, run };
}
export function generatedCancelled(cause: unknown): boolean {
 return cause instanceof DOMException && cause.name === 'AbortError' || Boolean(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ERR_CANCELED');
}
function optionsOf(value: unknown, field: GeneratedField): GeneratedOption[] {
 if (!Array.isArray(value)) return [];
 return value.flatMap((item: unknown) => {
  if (!item || typeof item !== 'object') return [];
  const row = item as GeneratedRow;
  const value = generatedValue(field, row.value ?? row.code);
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  return [{ value, label: String(row.label ?? row.describe ?? row.name ?? value), children: optionsOf(row.children, field) }];
 });
}
export async function generatedOptions(schema: GeneratedSchema, api: GeneratedApi, fromPage: boolean, signal: AbortSignal): Promise<Record<string, GeneratedOption[]>> {
 const dropdown = await api.dropdown?.(fromPage, signal) ?? {};
 const entries = await Promise.all(schema.fields.map(async (field): Promise<[string, GeneratedOption[]]> => {
  if (field.effectType === 'ForeignKey' || field.effectType === 'ApiTreeSelector') return [field.key, optionsOf(dropdown[field.key], field)];
  if (!field.dictTypeCode || !['ConstSelector', 'DictSelector', 'EnumSelector'].includes(field.effectType)) return [field.key, []];
  const code = encodeURIComponent(field.dictTypeCode);
  const path = field.effectType === 'EnumSelector' ? '/api/sysEnum/enumDataList' : field.effectType === 'ConstSelector' ? `/api/sysConst/data/${code}` : `/api/sysDictData/dataList/${code}`;
  const data = await requestClient.get<unknown>(path, { params: field.effectType === 'EnumSelector' ? { enumName: field.dictTypeCode } : undefined, signal, silentError: true });
  return [field.key, optionsOf(data, field)];
 }));
 return Object.fromEntries(entries);
}
export function generatedLabel(options: GeneratedOption[], value: unknown): string {
 for (const option of options) {
  if (String(option.value) === String(value)) return option.label;
  const child = generatedLabel(option.children ?? [], value);
  if (child) return child;
 }
 return '';
}
