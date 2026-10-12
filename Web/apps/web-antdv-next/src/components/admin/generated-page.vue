<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { GeneratedField as FieldDescriptor, GeneratedApi, GeneratedOption, GeneratedRow, GeneratedSchema } from './generated';

import { computed, nextTick, onActivated, onDeactivated, onMounted, onScopeDispose, ref, shallowRef, useId, watch } from 'vue';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Form, FormItem, message, Modal, Select, Switch } from 'antdv-next';

import { decodeFileResponse, downloadFile } from '#/api/file-response';
import { getPrintTemplate } from '#/api/system/print';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import NoticeContent from '#/components/notice-content/index.vue';
import { printPdf } from '#/components/pdfme/output';
import { parsePdfmeTemplate } from '#/components/pdfme/template';

import AuditRecord from './audit-record.vue';
import { createGeneratedSession, generatedCancelled, generatedKeys, generatedLabel, generatedOptions, generatedRowKey } from './generated';
import GeneratedField from './generated-field.vue';
import GeneratedFile from './generated-file.vue';
import ImportDialog from './import-dialog.vue';

const props = defineProps<{ schema: GeneratedSchema; api: GeneratedApi }>();
const emit = defineEmits<{ edit: [row?: GeneratedRow]; deactivate: [] }>();
const { hasAccessByCodes } = useAccess();
const user = useUserStore();
const session = createGeneratedSession();
const formId = useId();
const identity = computed(() => [user.userInfo?.userId, user.userInfo?.tenantId, user.userInfo?.currentTenantId].join(':'));
const can = (action: string) => user.userInfo?.accountType === 999 || hasAccessByCodes([`${props.schema.permission}:${action}`]);
const feedback = ref('');
const busy = ref(false);
const expanded = ref(false);
const active = ref(false);
let lifecycle = 0;
const confirmations = new Set<ReturnType<typeof Modal.confirm>>();
const options = shallowRef<Record<string, GeneratedOption[]>>({});
const importRef = ref<InstanceType<typeof ImportDialog>>();
const importMounted = ref(false);
const exportScope = ref<'all' | 'page' | 'selected'>('page');
const queryFields = computed(() => props.schema.fields.filter((field) => field.query && (expanded.value || !field.retract)));
const table = useAdminTable<GeneratedRow, GeneratedRow>({ query: {}, load: async (query, signal) => {
 const result = await session.run((tracked) => props.api.page(query, tracked), signal);
 return { ...result, items: result.items.map((row) => ({ ...row, __rowKey: generatedRowKey(props.schema, row) })) };
} });
const fields = computed(() => props.schema.fields.filter((field) => field.table));
const columns = computed<NonNullable<TableProps<GeneratedRow>['columns']>>(() => [
 ...fields.value.map((field) => ({ title: field.title, dataIndex: field.key, key: field.key, width: field.effectType === 'Editor' ? 220 : 160, sorter: field.sortable })),
 { title: '修改记录', key: 'audit', width: 180 },
 { title: '操作', key: 'actions', width: 190, fixed: 'end' },
]);
function cell(row: GeneratedRow, field: FieldDescriptor): string {
 const value = row[field.extendedKey ?? field.key] ?? row[field.key];
 return generatedLabel(options.value[field.key] ?? [], row[field.key]) || String(value ?? '');
}
const output = computed(() => props.schema.printType === 'auto' ? {
 fileName: props.schema.title, formatters: Object.fromEntries(fields.value.map((field) => [field.key, (row: GeneratedRow) => cell(row, field)]))
} : undefined);
async function reload() { await table.reload(); }
async function metadata() {
 const current = lifecycle;
 try { options.value = await session.run((signal) => generatedOptions(props.schema, props.api, true, signal)); }
 catch (cause) { if (current === lifecycle && !generatedCancelled(cause)) feedback.value = '字段选项加载失败，请重新加载'; }
}
async function operate(operation: (signal: AbortSignal) => Promise<unknown>) {
 if (busy.value || !active.value) return;
 const current = lifecycle;
 busy.value = true; feedback.value = '';
 try { await session.run(operation); message.success('操作成功'); await reload(); }
 catch (cause) { if (current === lifecycle && !generatedCancelled(cause)) feedback.value = cause instanceof Error ? cause.message : '操作失败，请重试'; }
 finally { if (current === lifecycle) busy.value = false; }
}
function remove(rows: GeneratedRow[]) {
 if (!rows.length) return;
 const current = lifecycle;
 const modal = Modal.confirm({ title: `确认删除 ${rows.length} 条${props.schema.title}记录？`, content: '删除后无法恢复。', onCancel: () => confirmations.delete(modal), onOk: async () => {
  try { if (current === lifecycle && active.value) await operate((signal) => rows.length === 1 ? props.api.delete(generatedKeys(props.schema, rows[0]!), signal) : props.api.batchDelete(rows.map((row) => generatedKeys(props.schema, row)), signal)); }
  finally { confirmations.delete(modal); }
 } });
 confirmations.add(modal);
}
function selectedRows(): GeneratedRow[] {
 return table.selectedKeys.value.map((key) => {
  const values: unknown = JSON.parse(String(key));
  if (!Array.isArray(values)) throw new Error('所选记录无效，请重新选择');
  return Object.fromEntries(props.schema.primaryKeys.map((field, index) => [field, values[index]]));
 });
}
async function setStatus(row: GeneratedRow, field: FieldDescriptor) {
 if (!props.api.setStatus) return;
 await operate((signal) => props.api.setStatus!({ ...generatedKeys(props.schema, row), [field.key]: row[field.key] === 1 ? 2 : 1 }, signal));
}
async function fileResult(operation: (signal: AbortSignal) => ReturnType<NonNullable<GeneratedApi['export']>>, fallback: string) {
 const current = lifecycle;
 const result = await decodeFileResponse(await session.run(operation), fallback);
 if (!active.value || current !== lifecycle) throw new DOMException('View closed', 'AbortError');
 if (result.kind !== 'file') throw new Error(result.message);
 downloadFile(result.file);
}
async function exportFile() {
 if (!props.api.export || busy.value || !active.value) return;
 const current = lifecycle;
 const selected = selectedRows();
 if (exportScope.value === 'selected' && !selected.length) { feedback.value = '请先选择需要导出的记录'; return; }
 busy.value = true; feedback.value = '';
 const query = { ...table.query.value, page: exportScope.value === 'all' || exportScope.value === 'selected' ? 1 : table.page.value, pageSize: exportScope.value === 'page' ? table.pageSize.value : Math.max(table.total.value, 1), field: table.field.value, order: table.order.value, selectKeys: exportScope.value === 'selected' ? selected : [], selectKeyList: exportScope.value === 'selected' ? selected.map((row) => row[props.schema.primaryKeys[0]!]) : [] };
 try { await fileResult((signal) => props.api.export!(query, signal), `${props.schema.title}.xlsx`); }
 catch (cause) { if (current === lifecycle && !generatedCancelled(cause)) feedback.value = cause instanceof Error ? cause.message : '导出失败，请重试'; }
 finally { if (current === lifecycle) busy.value = false; }
}
async function showImport() { importMounted.value = true; await nextTick(); importRef.value?.show(); }
async function customPrint() {
 if (!props.schema.printName || busy.value || !active.value) return;
 const current = lifecycle;
 busy.value = true; feedback.value = '';
 try {
  const rows = table.rows.value.filter((row) => table.selectedKeys.value.includes(String(row.__rowKey)));
  if (!rows.length) throw new Error('请先选择需要打印的记录');
  const template = await session.run(() => getPrintTemplate(props.schema.printName!));
  const generation = identity.value;
  await printPdf(parsePdfmeTemplate(template?.template), rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? '')]))), () => active.value && current === lifecycle && identity.value === generation);
 } catch (cause) { if (current === lifecycle && !generatedCancelled(cause)) feedback.value = cause instanceof Error ? cause.message : '打印失败，请重试'; }
 finally { if (current === lifecycle) busy.value = false; }
}
function clear() {
 lifecycle += 1; for (const modal of confirmations) modal.destroy(); confirmations.clear();
 active.value = false; session.clear(); emit('deactivate'); importMounted.value = false; options.value = {}; feedback.value = ''; busy.value = false;
 table.rows.value = []; table.total.value = 0; table.query.value = {}; table.selectedKeys.value = []; expanded.value = false;
}
function activate() { if (active.value) return; active.value = true; void metadata(); void reload(); }
watch(identity, () => { const visible = active.value; clear(); if (visible) activate(); }, { flush: 'sync' });
onMounted(activate); onActivated(activate); onDeactivated(clear); onScopeDispose(clear);
defineExpose({ reload });
</script>

<template>
 <Page :title="schema.title" auto-content-height>
  <div class="generated-page space-y-4">
   <Alert v-if="feedback" :title="feedback" type="error" role="alert"><template #action><Button size="small" @click="metadata">重新加载选项</Button></template></Alert>
   <Form layout="inline" :model="table.query.value" class="generated-query" @finish="table.search">
    <FormItem v-for="field in queryFields" :key="field.key" :label="field.title" :html-for="`${formId}-${field.key}`">
     <GeneratedField :id="`${formId}-${field.key}`" v-model="table.query.value[field.queryType === '~' ? `${field.key}Range` : field.key]" :field="field" :options="options[field.key]" query />
    </FormItem>
    <Button type="primary" html-type="submit" :auto-insert-space="false">查询</Button><Button :auto-insert-space="false" @click="table.reset">重置</Button>
    <Button v-if="schema.fields.some(field => field.query && field.retract)" @click="expanded = !expanded">{{ expanded ? '收起查询' : '展开查询' }}</Button>
   </Form>
   <AdminTable :controller="table" :columns="columns" row-key="__rowKey" selection :output="output" :scroll="{ x: 'max-content' }" :reload-disabled="busy">
    <template #toolbar>
     <Button v-if="can('add')" type="primary" :disabled="busy" :auto-insert-space="false" @click="emit('edit')">新增</Button>
     <Button v-if="can('batchDelete')" danger :disabled="busy || !table.selectedKeys.value.length" @click="remove(selectedRows())">删除所选记录</Button>
     <Button v-if="schema.importable && api.import && api.downloadTemplate && can('import')" :disabled="busy" @click="showImport">导入</Button>
     <template v-if="schema.importable && api.export && can('export')">
      <label :for="`${formId}-export`" class="sr-only">导出范围</label><Select :id="`${formId}-export`" v-model:value="exportScope" :options="[{ value: 'page', label: '当前页' }, { value: 'selected', label: '所选记录' }, { value: 'all', label: '全部记录' }]" style="width: 130px" />
      <Button :loading="busy" @click="exportFile">导出文件</Button>
     </template>
     <Button v-if="schema.printType === 'custom'" :disabled="busy" @click="customPrint">按模板打印</Button>
    </template>
    <template #bodyCell="{ column, record, text }">
     <div v-if="column.key === 'actions'" class="flex gap-1">
      <Button v-if="can('update')" type="link" size="small" :disabled="busy" :auto-insert-space="false" @click="emit('edit', record)">编辑</Button>
      <Button v-if="can('delete')" type="link" danger size="small" :disabled="busy" :auto-insert-space="false" @click="remove([record])">删除</Button>
     </div>
     <AuditRecord v-else-if="column.key === 'audit'" :record="record" />
     <template v-else v-for="field in fields.filter(item => item.key === column.key)" :key="field.key">
      <Switch v-if="field.isStatus && api.setStatus && can('setStatus')" :checked="record[field.key] === 1" :loading="busy" :aria-label="`切换${field.title}`" @change="setStatus(record, field)" />
      <GeneratedFile v-else-if="field.effectType === 'Upload' && record[field.key]" :url="String(record[field.key])" image />
      <NoticeContent v-else-if="field.effectType === 'Editor'" :content="String(record[field.key] ?? '')" />
      <GeneratedFile v-else-if="field.effectType === 'Upload_SingleFile' && record[field.key]" :url="String(record[field.key])" />
      <span v-else>{{ cell(record, field) || text }}</span>
     </template>
    </template>
   </AdminTable>
   <ImportDialog v-if="importMounted && api.import && api.downloadTemplate" ref="importRef" :title="`导入${schema.title}`" :template-name="`${schema.title}导入模板.xlsx`" :download-template="() => session.run(signal => api.downloadTemplate!(signal))" :import-file="file => session.run(signal => api.import!(file, signal))" @imported="reload" />
  </div>
 </Page>
</template>
<style scoped>
.generated-query { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.generated-query :deep(.ant-form-item) { margin-bottom: 0; }
.generated-query :deep(.generated-field) { min-width: 170px; max-width: 320px; }
</style>
