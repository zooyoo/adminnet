<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { ColumnOuput } from '#/api-services/models/column-ouput';
import type { DatabaseOutput } from '#/api-services/models/database-output';
import type { SysDictType } from '#/api-services/models/sys-dict-type';
import type { SysMenu } from '#/api-services/models/sys-menu';
import type { TableOutput } from '#/api-services/models/table-output';
import type { CodeGenDraft, CodeGenField, CodeGenId, CodeGenOption, CodeGenQuery, CodeGenRow } from '#/api/system/codegen';

import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, shallowRef, watch } from 'vue';

import { useAccess } from '@vben/access';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Checkbox, Form, FormItem, Input, InputNumber, message, Modal, Select, Switch } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { codegenApi } from '#/api/system/codegen';
import { listPrintTemplates } from '#/api/system/print';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';

import { copyCodeGenDraft, createCodeGenDraft, FIELD_FLAGS, FOREIGN_TYPES, isFieldFlag, protectedField, redactedConnection, SELECTOR_TYPES, validateCodeGenDraft, validateCodeGenFields } from './codegen-model';
import CodeGenPreview from './codegen-preview.vue';
import { createFieldSession, createFieldState } from './field-session';

defineOptions({ name: 'SysCodeGen' });
const user = useUserStore();
// 原代码生成菜单未预置按钮权限，沿用菜单路由准入，由真实 API 校验各项操作权限。
const permissions = computed(() => {
	const allowed = Boolean(user.userInfo?.userId);
	return { page: allowed, add: allowed, update: allowed, delete: allowed, sync: allowed, fields: allowed, saveFields: allowed };
});
const { hasAccessByCodes } = useAccess();
const queryVisible = computed(() => hasAccessByCodes(['sysMenu:list']));
const identity = computed(() => [user.userInfo?.userId, user.userInfo?.tenantId, user.userInfo?.currentTenantId, user.userInfo?.accountType].join(':'));
const page = useAdminTable<CodeGenRow, CodeGenQuery>({ query: { tableName: '', busName: '' }, load: (query, signal) => request((tracked) => codegenApi.page(query, AbortSignal.any([signal, tracked]))) });
const columns: NonNullable<TableProps<CodeGenRow>['columns']> = [
	{ title: '序号', key: 'sequence', width: 55, align: 'center' }, { title: '库定位器', key: 'configId', dataIndex: 'configId', width: 175 },
	{ title: '业务名称', key: 'busName', dataIndex: 'busName', width: 180 }, { title: '实体', key: 'tableName', dataIndex: 'tableName', width: 200 },
	{ title: '数据库', key: 'dbNickName', dataIndex: 'dbNickName', width: 140 }, { title: '命名空间', key: 'nameSpace', dataIndex: 'nameSpace', width: 240 },
	{ title: '作者', key: 'authorName', dataIndex: 'authorName', width: 130 }, { title: '生成方式', key: 'generateType', dataIndex: 'generateType', width: 130 },
	{ title: '操作', key: 'actions', fixed: 'end', width: 500 },
];
const preview = shallowRef<InstanceType<typeof CodeGenPreview>>();
const fieldState = reactive(createFieldState());
const fields = createFieldSession(fieldState, { load: codegenApi.fields, save: codegenApi.saveFields }, sessionBoundary);
const fieldDialog = shallowRef(false);
const fieldTitle = shallowRef('');
const fieldTable = useAdminTable<CodeGenField, Record<string, unknown>>({ query: {}, load: async () => {
	if (fieldState.id !== undefined) await fields.load(fieldState.id);
	return { items: fieldState.rows, total: fieldState.rows.length };
} });
watch(() => fieldState.rows, (rows) => { fieldTable.rows.value = rows; fieldTable.total.value = rows.length; }, { immediate: true });
const dirtyFields = computed(() => JSON.stringify(fieldState.rows) !== fieldState.baseline);
const fieldLabels: Record<string, string> = { whetherTable: '显示', whetherAddUpdate: '增改', whetherImport: '导入', whetherRequired: '必填', whetherSortable: '可排序', whetherQuery: '查询', whetherRetract: '查询折叠' };
const fieldColumns: NonNullable<TableProps<CodeGenField>['columns']> = [
	{ title: '实体属性', key: 'propertyName', dataIndex: 'propertyName', width: 180, fixed: 'start' },
	{ title: '字段信息', key: 'metadata', children: [
		{ title: '描述', key: 'columnComment', dataIndex: 'columnComment', width: 190 }, { title: '数据类型', key: 'netType', dataIndex: 'netType', width: 150 },
		{ title: '作用类型', key: 'effectType', dataIndex: 'effectType', width: 200 }, { title: '字典／枚举／常量', key: 'dictTypeCode', dataIndex: 'dictTypeCode', width: 200 },
	] },
	{ title: '生成选项', key: 'switches', children: FIELD_FLAGS.filter((key) => key !== 'whetherQuery' && key !== 'whetherRetract').map((key) => ({ title: fieldLabels[key], key, dataIndex: key, width: 95, align: 'center' })) },
	{ title: '查询设置', key: 'queries', children: [
		{ title: '查询', key: 'whetherQuery', dataIndex: 'whetherQuery', width: 95, align: 'center' },
		{ title: '查询方式', key: 'queryType', dataIndex: 'queryType', width: 140 },
		{ title: '查询折叠', key: 'whetherRetract', dataIndex: 'whetherRetract', width: 110, align: 'center' },
	] },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 120, fixed: 'end' },
];
const editorOpen = shallowRef(false);
const editorCopy = shallowRef(false);
const draft = reactive<CodeGenDraft>(createCodeGenDraft());
const editorError = shallowRef('');
const operationBusy = shallowRef(false);
const metadataBusy = shallowRef(false);
const metadataError = shallowRef('');
const databases = shallowRef<DatabaseOutput[]>([]);
const tables = shallowRef<TableOutput[]>([]);
const entityColumns = shallowRef<ColumnOuput[]>([]);
const namespaces = shallowRef<string[]>([]);
const menus = shallowRef<SysMenu[]>([]);
const dictionaryTypes = shallowRef<SysDictType[]>([]);
const constantOptions = shallowRef<CodeGenOption[]>([]);
const effectOptions = shallowRef<CodeGenOption[]>([]);
const queryOptions = shallowRef<CodeGenOption[]>([]);
const generateOptions = shallowRef<CodeGenOption[]>([]);
const printOptions = shallowRef<CodeGenOption[]>([]);
const printTemplateOptions = shallowRef<CodeGenOption[]>([]);
const foreignOpen = shallowRef(false);
const foreignDraft = reactive<CodeGenField>({ id: '', codeGenId: '', fkDisplayColumnList: [] });
const foreignEffectRevisions = reactive<Record<string, number>>({});
const foreignTables = shallowRef<TableOutput[]>([]);
const foreignColumns = shallowRef<ColumnOuput[]>([]);
const foreignError = shallowRef('');
const foreignBusy = shallowRef(false);
const controllers = new Set<AbortController>();
let context = 0;
let tableGeneration = 0;
let editorGeneration = 0;
let foreignGeneration = 0;
let active = false;

const databaseOptions = computed(() => databases.value.map((item) => ({ value: item.configId ?? '', label: `${item.dbNickName ?? item.configId} (${item.dbType})` })));
const databaseTypeOptions = [{"label":"MySql","value":"0"},{"label":"SqlServer","value":"1"},{"label":"Sqlite","value":"2"},{"label":"Oracle","value":"3"},{"label":"PostgreSQL","value":"4"},{"label":"Dm","value":"5"},{"label":"Kdbndp","value":"6"},{"label":"Oscar","value":"7"},{"label":"MySqlConnector","value":"8"},{"label":"Access","value":"9"},{"label":"OpenGauss","value":"10"},{"label":"QuestDB","value":"11"},{"label":"HG","value":"12"},{"label":"ClickHouse","value":"13"},{"label":"GBase","value":"14"},{"label":"Odbc","value":"15"},{"label":"OceanBaseForOracle","value":"16"},{"label":"TDengine","value":"17"},{"label":"GaussDB","value":"18"},{"label":"OceanBase","value":"19"},{"label":"Tidb","value":"20"},{"label":"Vastbase","value":"21"},{"label":"PolarDB","value":"22"},{"label":"Doris","value":"23"},{"label":"Custom","value":"900"}];
const tableOptions = computed(() => tables.value.map((item) => ({ value: item.entityName ?? '', label: `${item.tableName} [${item.tableComment ?? ''}] — ${item.entityName}` })));
const entityColumnOptions = computed(() => entityColumns.value.map((item) => ({ value: item.propertyName ?? '', label: `${item.propertyName} [${item.columnComment ?? ''}]` })));
const namespaceOptions = computed(() => namespaces.value.map((value) => ({ value, label: value })));
const menuOptions = computed(() => [{ value: 0, label: '顶级菜单' }, ...menus.value.filter((item) => item.type !== 3).map((item) => ({ value: item.id ?? 0, label: `${item.title} (${item.name})` }))]);
const foreignTableOptions = computed(() => foreignTables.value.map((item) => ({ value: item.tableName ?? '', label: `${item.tableName} [${item.tableComment ?? ''}]` })));
const foreignColumnOptions = computed(() => foreignColumns.value.map((item) => ({ value: item.propertyName ?? '', label: `${item.propertyName} [${item.columnComment ?? ''}]` })));
const connectionLabel = computed(() => redactedConnection(draft.connectionString));
const editableField = (_row: CodeGenField, key: string) => permissions.value.saveFields && !fieldState.busy && key !== 'propertyName' && key !== 'netType';
function dictionaryOptions(field: CodeGenField) {
	if (field.effectType === 'ConstSelector') return constantOptions.value;
	return dictionaryTypes.value.filter((item) => field.effectType === 'EnumSelector' ? item.code?.endsWith('Enum') : !item.code?.endsWith('Enum')).map((item) => ({ value: item.code ?? '', label: item.name ?? item.code ?? '' }));
}
async function request<T>(work: (signal: AbortSignal) => Promise<T>) {
	const controller = new AbortController();
	const current = context;
	controllers.add(controller);
	sessionBoundary.track(controller);
	try {
		const result = await work(controller.signal);
		if (controller.signal.aborted || current !== context) throw new Error('请求已取消');
		return result;
	} finally { controllers.delete(controller); sessionBoundary.release(controller); }
}
async function loadPrintOptions(signal: AbortSignal) {
	const options: CodeGenOption[] = [];
	for (let page = 1; page <= 500; page++) {
		const result = await listPrintTemplates({ page, pageSize: 100 }, signal);
		options.push(...result.items.map((item) => ({ value: item.name ?? '', label: item.name ?? '' })));
		if (options.length >= result.total) return options;
		if (!result.items.length) throw new Error('打印模板列表不完整');
	}
	throw new Error('打印模板数量超过选择范围');
}
async function loadMetadata() {
	metadataBusy.value = true;
	metadataError.value = '';
	const current = context;
	try {
		const result = await request((signal) => Promise.all([
			codegenApi.databases(signal), codegenApi.namespaces(signal), codegenApi.menus(signal), codegenApi.dictionaries(signal), codegenApi.constants(signal),
			codegenApi.options('code_gen_effect_type', signal), codegenApi.options('code_gen_query_type', signal), codegenApi.options('code_gen_create_type', signal), codegenApi.options('code_gen_print_type', signal), loadPrintOptions(signal),
		]));
		[databases.value, namespaces.value, menus.value, dictionaryTypes.value] = result;
		constantOptions.value = result[4].map((item) => ({ value: item.code ?? '', label: item.name ?? item.code ?? '' }));
		effectOptions.value = result[5]; queryOptions.value = result[6]; generateOptions.value = result[7]; printOptions.value = result[8]; printTemplateOptions.value = result[9];
	} catch { if (current === context) metadataError.value = '配置选项加载失败，请重试。'; }
	finally { if (current === context) metadataBusy.value = false; }
}
async function loadTables(configId: string, clear = true) {
	const current = ++tableGeneration;
	if (clear) { draft.tableName = ''; entityColumns.value = []; }
	tables.value = [];
	const database = databases.value.find((item) => item.configId === configId);
	if (database) { draft.dbNickName = database.dbNickName; draft.dbName = database.dbNickName; draft.dbType = String(database.dbType); draft.connectionString = database.connectionString; }
	try {
		const result = await request((signal) => codegenApi.tables(configId, signal));
		if (current === tableGeneration && draft.configId === configId) tables.value = result;
	} catch { if (current === tableGeneration && editorOpen.value) editorError.value = '实体列表加载失败，请重新选择数据库。'; }
}
async function chooseEntity(value: unknown, hydrate = false) {
	const entityName = String(value ?? '');
	if (!hydrate && draft.tableName && draft.tableName !== entityName) draft.tableUniqueList = [];
	draft.tableName = entityName;
	const table = tables.value.find((item) => item.entityName === entityName);
	if (!table?.tableName || !draft.configId) return;
	draft.tableComment = table.tableComment;
	if (!hydrate || !draft.id) draft.busName = table.tableComment ?? entityName;
	try {
		const result = await request((signal) => codegenApi.columns(table.tableName ?? '', draft.configId ?? '', signal));
		if (draft.tableName === entityName) entityColumns.value = result;
	} catch { if (editorOpen.value && draft.tableName === entityName) editorError.value = '实体字段加载失败，请重新选择实体。'; }
}
async function openEditor(row?: CodeGenRow, copy = false) {
	editorCopy.value = copy;
	const generation = ++editorGeneration;
	editorError.value = '';
	editorOpen.value = true;
	Object.assign(draft, createCodeGenDraft(), { id: undefined, connectionString: '', dbName: '', dbType: '', tableComment: '' });
	try {
		const detail = row ? await request((signal) => codegenApi.detail(row.id, signal)) : undefined;
		if (!editorOpen.value || generation !== editorGeneration) return;
		Object.assign(draft, detail && copy ? copyCodeGenDraft(detail) : createCodeGenDraft(detail));
		draft.nameSpace ||= namespaces.value[0] ?? '';
		if (draft.configId) { await loadTables(draft.configId, false); if (draft.tableName) await chooseEntity(draft.tableName, true); }
	} catch { if (editorOpen.value) editorError.value = '生成配置加载失败，请关闭后重试。'; }
}
async function saveEditor() {
	if (operationBusy.value) return;
	editorError.value = validateCodeGenDraft(draft);
	if (editorError.value) return;
	operationBusy.value = true;
	const current = context;
	try {
		const snapshot = { ...draft, tableUniqueList: draft.tableUniqueList.map((item) => ({ ...item, columns: [...(item.columns ?? [])] })) };
		await request((signal) => draft.id ? codegenApi.update(snapshot, signal) : codegenApi.add(snapshot, signal));
		if (current !== context) return;
		editorOpen.value = false;
		draft.connectionString = '';
		void message.success('生成配置已保存');
		await page.reload();
	} catch { if (current === context) editorError.value = '生成配置保存失败，草稿已保留，可修正后重试。'; }
	finally { if (current === context) operationBusy.value = false; }
}
async function openFields(row: CodeGenRow) {
	fieldTitle.value = row.busName ?? row.tableName ?? '';
	fieldDialog.value = true;
	await fields.load(row.id);
}
async function saveFields() {
	if (!permissions.value.saveFields) return;
	if (await fields.save()) void message.success('字段配置已保存');
}
function closeFields() { fieldDialog.value = false; foreignOpen.value = false; fields.close(); }
function changeFlag(field: CodeGenField, key: unknown, value: unknown) {
	if (!isFieldFlag(key)) return;
	if (['whetherAddUpdate', 'whetherImport', 'whetherRequired'].includes(key) && protectedField(field)) return;
	field[key] = value ? 'Y' : 'N';
}
function changeEffect(field: CodeGenField, value: unknown) {
	if (protectedField(field)) return;
	const effectType = String(value ?? '');
	if (effectType === field.effectType) return;
	if (FOREIGN_TYPES.includes(effectType)) void openForeign({ ...field, effectType });
	else { field.effectType = effectType; if (SELECTOR_TYPES.includes(effectType)) field.dictTypeCode = ''; }
}
async function syncFields(row: CodeGenRow) {
	Modal.confirm({ title: '同步实体字段', content: '同步新增、移除和元数据变化的字段，保留仍存在字段的自定义选项。', okText: '同步字段', cancelText: '取消', onOk: async () => {
		operationBusy.value = true;
		const current = context;
		try {
			const detail = await request((signal) => codegenApi.detail(row.id, signal));
			await request((signal) => codegenApi.sync(createCodeGenDraft(detail), signal));
			if (current === context) { void message.success('字段已同步'); await page.reload(); }
		} catch { if (current === context) void message.error('字段同步失败，请重试。'); }
		finally { if (current === context) operationBusy.value = false; }
	} });
}
function deleteRows(ids: CodeGenId[]) {
	if (!ids.length) return;
	Modal.confirm({ title: '删除生成配置', content: `删除 ${ids.length} 项配置及其字段配置？`, okText: '删除配置', okButtonProps: { danger: true }, cancelText: '取消', onOk: async () => {
		operationBusy.value = true;
		const current = context;
		try { await request((signal) => codegenApi.delete(ids, signal)); if (current === context) { page.setSelectedKeys([]); void message.success('生成配置已删除'); await page.reload(); } }
		catch { if (current === context) void message.error('删除生成配置失败，请重试。'); }
		finally { if (current === context) operationBusy.value = false; }
	} });
}
async function openForeign(field: CodeGenField) {
	Object.assign(foreignDraft, field, { fkDisplayColumnList: [...(field.fkDisplayColumnList ?? [])] });
	foreignOpen.value = true;
	foreignError.value = '';
	foreignTables.value = []; foreignColumns.value = [];
	if (foreignDraft.fkConfigId) {
		await chooseForeignDatabase(foreignDraft.fkConfigId, false);
		if (foreignDraft.fkTableName) await chooseForeignTable(foreignDraft.fkTableName, false);
	}
}
async function chooseForeignDatabase(value: unknown, clear = true) {
	const configId = String(value ?? '');
	foreignDraft.fkConfigId = configId;
	if (clear) { foreignDraft.fkTableName = ''; foreignDraft.fkEntityName = ''; foreignDraft.fkLinkColumnName = ''; foreignDraft.fkDisplayColumnList = []; foreignDraft.pidColumn = ''; }
	foreignTables.value = []; foreignColumns.value = [];
	const current = ++foreignGeneration;
	foreignBusy.value = true;
	try { const result = await request((signal) => codegenApi.tables(configId, signal)); if (current === foreignGeneration && foreignOpen.value) foreignTables.value = result; }
	catch { if (current === foreignGeneration && foreignOpen.value) foreignError.value = '关联表列表加载失败，请重试。'; }
	finally { if (current === foreignGeneration) foreignBusy.value = false; }
}
async function chooseForeignTable(value: unknown, clear = true) {
	const tableName = String(value ?? '');
	foreignDraft.fkTableName = tableName;
	foreignDraft.fkEntityName = foreignTables.value.find((item) => item.tableName === tableName)?.entityName;
	if (clear) { foreignDraft.fkLinkColumnName = ''; foreignDraft.fkDisplayColumnList = []; foreignDraft.pidColumn = ''; }
	foreignColumns.value = [];
	const current = ++foreignGeneration;
	foreignBusy.value = true;
	try {
		const result = await request((signal) => codegenApi.columns(tableName, foreignDraft.fkConfigId ?? '', signal));
		if (current === foreignGeneration && foreignOpen.value) { foreignColumns.value = result; if (clear) foreignDraft.fkLinkColumnName = result.find((item) => (item.isPrimarykey || item.columnKey === 'True'))?.propertyName ?? ''; }
	} catch { if (current === foreignGeneration && foreignOpen.value) foreignError.value = '关联字段加载失败，请重试。'; }
	finally { if (current === foreignGeneration) foreignBusy.value = false; }
}
function cancelForeign() {
	foreignOpen.value = false;
	const id = String(foreignDraft.id);
	foreignEffectRevisions[id] = (foreignEffectRevisions[id] ?? 0) + 1;
}
function applyForeign() {
	foreignError.value = validateCodeGenFields([foreignDraft]);
	if (foreignError.value) return;
	foreignDraft.fkColumnNetType = foreignColumns.value.find((column) => column.propertyName === foreignDraft.fkLinkColumnName)?.netType;
	if (foreignDraft.effectType !== 'ApiTreeSelector') foreignDraft.pidColumn = null;
	const field = fieldState.rows.find((item) => item.id === foreignDraft.id);
	if (field) Object.assign(field, foreignDraft, { fkDisplayColumnList: [...(foreignDraft.fkDisplayColumnList ?? [])] });
	foreignOpen.value = false;
}
function closeEditor() { editorGeneration += 1; editorOpen.value = false; draft.connectionString = ''; }
function deactivate() {
	active = false; context += 1; tableGeneration += 1; foreignGeneration += 1;
	for (const id of Object.keys(foreignEffectRevisions)) delete foreignEffectRevisions[id];
	for (const controller of controllers) controller.abort();
	controllers.clear(); fields.close(); preview.value?.close();
	editorOpen.value = false; fieldDialog.value = false; foreignOpen.value = false;
	Object.assign(draft, createCodeGenDraft(), { id: undefined, connectionString: '', dbName: '', dbType: '', tableComment: '' });
	databases.value = []; tables.value = []; entityColumns.value = []; menus.value = []; dictionaryTypes.value = []; namespaces.value = []; constantOptions.value = [];
	foreignTables.value = []; foreignColumns.value = [];
	Object.assign(foreignDraft, { id: '', codeGenId: '', fkConfigId: '', fkTableName: '', fkEntityName: '', fkDisplayColumnList: [], fkLinkColumnName: '', pidColumn: '', fkColumnNetType: '' });
	page.rows.value = []; page.total.value = 0; page.selectedKeys.value = [];
	operationBusy.value = false; metadataBusy.value = false; foreignBusy.value = false;
}
function activate() {
	if (active) return;
	active = true;
	if (permissions.value.page) { void loadMetadata(); void page.reload(); }
}
watch([identity, permissions], () => { const visible = active; deactivate(); if (visible) activate(); }, { flush: 'sync' });
onMounted(activate); onActivated(activate); onDeactivated(deactivate); onScopeDispose(deactivate);
</script>

<template>
	<div class="codegen-page">
		<Alert v-if="!permissions.page" type="warning" show-icon title="当前账号没有查询代码生成配置权限。" />
		<template v-else>
			<Form :model="page.query.value" layout="inline" :colon="false" :required-mark="false" class="codegen-query" @finish="page.search">
				<FormItem label="查询实体"><Input v-model:value="page.query.value.tableName" allow-clear @keydown.enter.prevent @keyup.enter="page.search()" /></FormItem>
				<FormItem label="查询业务名称"><Input v-model:value="page.query.value.busName" allow-clear @keydown.enter.prevent @keyup.enter="page.search()" /></FormItem>
				<Button v-if="queryVisible" type="primary" html-type="submit" :auto-insert-space="false">查询配置</Button>
				<Button :auto-insert-space="false" @click="page.reset">重置查询</Button>
			</Form>
			<Alert v-if="metadataError" type="warning" show-icon :title="metadataError"><template #action><Button size="small" @click="loadMetadata">重新加载选项</Button></template></Alert>
			<AdminTable :controller="page" :columns="columns" aria-label="代码生成配置" row-key="id" :selection="permissions.delete" :reload-disabled="operationBusy">
				<template #toolbar>
					<Button v-if="permissions.add" type="primary" :auto-insert-space="false" :disabled="operationBusy || metadataBusy || !!metadataError" @click="openEditor()">新增生成配置</Button>
					<Button v-if="permissions.delete" danger :auto-insert-space="false" :disabled="operationBusy || !page.selectedKeys.value.length" @click="deleteRows([...page.selectedKeys.value])">删除所选配置</Button>
				</template>
				<template #bodyCell="{ column, record, text, index }">
					<span v-if="column.key === 'sequence'">{{ index + 1 }}</span>
					<span v-else-if="column.key === 'generateType'">{{ generateOptions.find((item) => item.value === record.generateType)?.label ?? text }}</span>
					<div v-else-if="column.key === 'actions'" class="codegen-actions">
						<Button type="link" size="small" :auto-insert-space="false" :disabled="operationBusy" @click="preview?.show(record)">预览代码</Button>
					<Button v-if="permissions.fields" type="link" size="small" :auto-insert-space="false" :disabled="operationBusy || metadataBusy" @click="openFields(record)">字段配置</Button>
						<Button v-if="permissions.sync" type="link" size="small" :auto-insert-space="false" :disabled="operationBusy" @click="syncFields(record)">同步字段</Button>
						<Button v-if="permissions.update" type="link" size="small" :auto-insert-space="false" :disabled="operationBusy || metadataBusy" @click="openEditor(record)">编辑并重建</Button>
						<Button v-if="permissions.add" type="link" size="small" :auto-insert-space="false" :disabled="operationBusy || metadataBusy" @click="openEditor(record, true)">复制配置</Button>
						<Button v-if="permissions.delete" type="link" danger size="small" :auto-insert-space="false" :disabled="operationBusy" @click="deleteRows([record.id])">删除配置</Button>
					</div>
					<span v-else-if="column.dataIndex">{{ text }}</span>
				</template>
			</AdminTable>
		</template>
		<CodeGenPreview ref="preview" />
		<Modal :open="editorOpen" :title="draft.id ? '编辑生成配置并重建字段' : editorCopy ? '复制生成配置' : '新增生成配置'" :width="1000" :footer="null" destroy-on-hidden :mask-closable="false" :closable="!operationBusy" :keyboard="!operationBusy" @cancel="closeEditor">
			<Form :model="draft" layout="vertical" :colon="false" :required-mark="false" class="codegen-editor" @finish="saveEditor">
				<Alert v-if="editorError" type="error" role="alert" show-icon :title="editorError" class="codegen-wide" />
				<Alert v-if="draft.id" type="warning" show-icon title="保存主配置会按实体重建字段并恢复默认值。仅调整字段选项请使用字段配置；刷新结构并保留选项请使用同步字段。" class="codegen-wide" />
				<FormItem label="数据库" html-for="codegen-database"><Select id="codegen-database" aria-label="数据库" :value="draft.configId ?? undefined" :options="databaseOptions" :disabled="operationBusy" show-search @update:value="(value) => { draft.configId = String(value); loadTables(String(value)); }" /></FormItem>
				<FormItem label="实体" html-for="codegen-entity"><Select id="codegen-entity" aria-label="实体" :value="draft.tableName ?? undefined" :options="tableOptions" :disabled="operationBusy || !draft.configId" show-search @update:value="chooseEntity" /></FormItem>
				<FormItem label="数据库地址"><Input :value="connectionLabel" readonly aria-label="数据库地址" /></FormItem>
				<FormItem label="数据表说明"><Input aria-label="数据表说明" v-model:value="draft.tableComment" readonly /></FormItem>
				<FormItem label="业务名称"><Input aria-label="业务名称" v-model:value="draft.busName" :maxlength="100" :disabled="operationBusy" /></FormItem>
				<FormItem label="作者"><Input aria-label="作者" v-model:value="draft.authorName" :maxlength="100" :disabled="operationBusy" /></FormItem>
				<FormItem label="应用命名空间" html-for="codegen-namespace"><Select id="codegen-namespace" aria-label="应用命名空间" v-model:value="draft.nameSpace" :options="namespaceOptions" :disabled="operationBusy" show-search /></FormItem>
				<FormItem label="库类型" html-for="codegen-db-type"><Select id="codegen-db-type" aria-label="库类型" :value="draft.dbType" :options="databaseTypeOptions" disabled /></FormItem>
				<FormItem label="生成方式" html-for="codegen-generate"><Select id="codegen-generate" aria-label="生成方式" v-model:value="draft.generateType" :options="generateOptions" :disabled="operationBusy" /></FormItem>
				<FormItem label="移除表前缀"><Input aria-label="移除表前缀" v-model:value="draft.tablePrefix" :disabled="operationBusy" /></FormItem>
				<FormItem label="生成菜单"><Switch aria-label="生成菜单" v-model:checked="draft.generateMenu" :disabled="operationBusy" /></FormItem>
				<FormItem label="上级菜单" html-for="codegen-parent"><Select id="codegen-parent" aria-label="上级菜单" :value="draft.menuPid ?? 0" :options="menuOptions" :disabled="operationBusy || !draft.generateMenu" show-search @update:value="(value) => draft.menuPid = Number(value)" /></FormItem>
				<FormItem label="菜单图标"><Input aria-label="菜单图标" v-model:value="draft.menuIcon" :disabled="operationBusy || !draft.generateMenu" /></FormItem>
				<FormItem label="菜单页面目录"><Input aria-label="菜单页面目录" v-model:value="draft.pagePath" :disabled="operationBusy || !draft.generateMenu" /></FormItem>
				<FormItem label="打印类型" html-for="codegen-print"><Select id="codegen-print" aria-label="打印类型" v-model:value="draft.printType" :options="printOptions" :disabled="operationBusy" @change="() => { if (draft.printType === 'off') draft.printName = ''; }" /></FormItem>
				<FormItem v-if="draft.printType === 'custom'" label="打印模板名称" html-for="codegen-print-template"><Select id="codegen-print-template" v-model:value="draft.printName" :options="printTemplateOptions" show-search option-filter-prop="label" :disabled="operationBusy" /></FormItem>
				<div class="codegen-wide codegen-unique">
					<div class="codegen-actions"><strong>唯一约束</strong><Button :auto-insert-space="false" :disabled="operationBusy" @click="draft.tableUniqueList.push({ columns: [], message: '' })">添加唯一约束</Button></div>
					<div v-for="(item, index) in draft.tableUniqueList" :key="index" class="codegen-unique-row">
						<label class="codegen-sr-only" :for="`codegen-unique-${index}`">唯一约束 {{ index + 1 }} 字段</label><Select :id="`codegen-unique-${index}`" v-model:value="item.columns" :options="entityColumnOptions" mode="multiple" :aria-label="`唯一约束 ${index + 1} 字段`" :disabled="operationBusy" />
						<Input v-model:value="item.message" :aria-label="`唯一约束 ${index + 1} 提示`" :disabled="operationBusy" placeholder="重复数据提示" />
						<Button danger :disabled="operationBusy" :auto-insert-space="false" @click="draft.tableUniqueList.splice(index, 1)">移除约束</Button>
					</div>
				</div>
				<div class="codegen-wide codegen-footer"><Button :disabled="operationBusy" :auto-insert-space="false" @click="closeEditor">取消编辑</Button><Button type="primary" html-type="submit" :loading="operationBusy" :auto-insert-space="false">保存生成配置</Button></div>
			</Form>
		</Modal>
		<Modal :open="fieldDialog" :title="`字段配置 — ${fieldTitle}`" width="96vw" :footer="null" destroy-on-hidden :mask-closable="false" :closable="!fieldState.busy" :keyboard="!fieldState.busy" @cancel="closeFields">
			<Alert v-if="fieldState.error" type="error" role="alert" show-icon :title="fieldState.error" class="codegen-field-error" />
			<p role="status">{{ fieldState.busy ? '正在处理字段配置…' : dirtyFields ? '有尚未保存的字段更改' : '字段配置已加载' }}</p>
			<AdminTable :controller="fieldTable" :columns="fieldColumns" row-key="id" aria-label="可编辑字段" :editable="editableField" :pagination="false" :scroll="{ x: 2200, y: 520 }" :reload-disabled="dirtyFields || fieldState.busy">
				<template #editCell="{ column, record }">
					<Input v-if="column.key === 'columnComment'" v-model:value="record.columnComment" :aria-label="`${record.propertyName} 描述`" :maxlength="128" />
					<div v-else-if="column.key === 'effectType'" class="codegen-effect">
						<label class="codegen-sr-only" :for="`codegen-effect-${record.id}`">{{ record.propertyName }} 作用类型</label><Select :key="`${record.id}:${foreignEffectRevisions[String(record.id)] ?? 0}`" :id="`codegen-effect-${record.id}`" :value="record.effectType" :options="effectOptions" :disabled="protectedField(record)" :aria-label="`${record.propertyName} 作用类型`" @update:value="(value) => changeEffect(record, value)" />
						<Button v-if="FOREIGN_TYPES.includes(record.effectType ?? '')" size="small" :aria-label="`${record.propertyName} 关联配置`" @click="openForeign(record)">配置</Button>
					</div>
					<span v-else-if="column.key === 'dictTypeCode'"><label class="codegen-sr-only" :for="`codegen-dict-${record.id}`">{{ record.propertyName }} 字典</label><Select :id="`codegen-dict-${record.id}`" v-model:value="record.dictTypeCode" :options="dictionaryOptions(record)" allow-clear :disabled="!SELECTOR_TYPES.includes(record.effectType ?? '')" :aria-label="`${record.propertyName} 字典`" /></span>
					<Checkbox v-else-if="isFieldFlag(column.key)" :checked="record[column.key] === 'Y'" :disabled="['whetherAddUpdate', 'whetherImport', 'whetherRequired'].includes(column.key) && protectedField(record)" :aria-label="`${record.propertyName} ${fieldLabels[column.key]}`" @update:checked="(value) => changeFlag(record, column.key, value)" />
					<span v-else-if="column.key === 'queryType'"><label class="codegen-sr-only" :for="`codegen-query-${record.id}`">{{ record.propertyName }} 查询方式</label><Select :id="`codegen-query-${record.id}`" v-model:value="record.queryType" :options="queryOptions" :disabled="record.whetherQuery !== 'Y'" :aria-label="`${record.propertyName} 查询方式`" /></span>
					<InputNumber v-else-if="column.key === 'orderNo'" v-model:value="record.orderNo" :min="0" :max="1000000" :precision="0" :aria-label="`${record.propertyName} 排序`" />
				</template>
				<template #bodyCell="{ text }"><span>{{ text }}</span></template>
			</AdminTable>
			<div class="codegen-footer"><Button :auto-insert-space="false" :disabled="fieldState.busy" @click="closeFields">{{ dirtyFields ? '放弃更改并关闭' : '关闭字段配置' }}</Button><Button v-if="permissions.saveFields" type="primary" :auto-insert-space="false" :loading="fieldState.busy" @click="saveFields">保存字段配置</Button></div>
		</Modal>
		<Modal :open="foreignOpen" :title="foreignDraft.effectType === 'ApiTreeSelector' ? '树选择器配置' : '外键配置'" :width="650" :footer="null" destroy-on-hidden :mask-closable="false" @cancel="cancelForeign">
			<Form :model="foreignDraft" layout="vertical" :colon="false" :required-mark="false" @finish="applyForeign">
				<Alert v-if="foreignError" role="alert" type="error" show-icon :title="foreignError" />
				<FormItem label="关联数据库" html-for="codegen-foreign-database"><Select id="codegen-foreign-database" aria-label="关联数据库" :value="foreignDraft.fkConfigId" :options="databaseOptions" :disabled="foreignBusy" @update:value="chooseForeignDatabase" /></FormItem>
				<FormItem label="关联表" html-for="codegen-foreign-table"><Select id="codegen-foreign-table" aria-label="关联表" :value="foreignDraft.fkTableName" :options="foreignTableOptions" :disabled="foreignBusy" show-search @update:value="chooseForeignTable" /></FormItem>
				<FormItem label="显示字段" html-for="codegen-foreign-display"><Select id="codegen-foreign-display" aria-label="显示字段" v-model:value="foreignDraft.fkDisplayColumnList" :options="foreignColumnOptions" :disabled="foreignBusy" mode="multiple" /></FormItem>
				<FormItem label="值字段" html-for="codegen-foreign-value"><Select id="codegen-foreign-value" aria-label="值字段" v-model:value="foreignDraft.fkLinkColumnName" :options="foreignColumnOptions" :disabled="foreignBusy" show-search /></FormItem>
				<FormItem v-if="foreignDraft.effectType === 'ApiTreeSelector'" label="父级字段" html-for="codegen-foreign-parent"><Select id="codegen-foreign-parent" aria-label="父级字段" v-model:value="foreignDraft.pidColumn" :options="foreignColumnOptions" :disabled="foreignBusy" show-search /></FormItem>
				<div class="codegen-footer"><Button :auto-insert-space="false" @click="cancelForeign">取消关联配置</Button><Button type="primary" html-type="submit" :auto-insert-space="false" :disabled="foreignBusy">应用关联配置</Button></div>
			</Form>
		</Modal>
	</div>
</template>

<style scoped>
.codegen-page { display: grid; gap: 16px; padding: 16px; min-width: 0; }
.codegen-query, .codegen-actions, .codegen-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.codegen-query { row-gap: 16px; }
.codegen-query :deep(.ant-form-item) { margin-bottom: 0; }
.codegen-editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.codegen-wide { grid-column: 1 / -1; }
.codegen-unique { display: grid; gap: 12px; margin: 8px 0 24px; }
.codegen-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.codegen-unique-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 12px; }
.codegen-footer { justify-content: flex-end; margin-top: 16px; }
.codegen-effect { display: flex; gap: 6px; }
.codegen-effect :deep(.ant-select) { flex: 1; min-width: 0; }
.codegen-field-error { margin-bottom: 12px; }
.codegen-page :deep(.admin-table) { min-width: 0; }
:deep(.ant-table-cell .ant-select) { min-width: 110px; width: 100%; }
:deep(.ant-table-cell .ant-input-number) { width: 100%; }
</style>
