<script setup lang="ts">
import type { Template } from '@pdfme/common';
import type { FormInstance, TableProps } from 'antdv-next';

import type { AddPrintInput, SysPrint, UpdatePrintInput } from '#/api-services/models';

import { computed, nextTick, onBeforeUnmount, onDeactivated, reactive, ref, shallowRef, watch } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Designer } from '@pdfme/ui';
import { Button, Form, FormItem, Input, InputNumber, message, Modal, Popconfirm, RadioGroup, Select, Switch, Tag, TextArea, Tooltip } from 'antdv-next';

import { getTenantOptionsApi } from '#/api';
import { sessionBoundary } from '#/api/session';
import { listPrintTemplates, removePrintTemplate, savePrintTemplate } from '#/api/system/print';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import { parsePrintParameters, previewPdf, printPdf, sendToPrintService } from '#/components/pdfme/output';
import { createDefaultTemplate, createTableTemplate, loadPdfmeOptions, parsePdfmeInputs, parsePdfmeTemplate, pdfmePlugins } from '#/components/pdfme/template';

defineOptions({ name: 'SysPrint' });

type PrintRecord = Record<string, unknown> & SysPrint;
const { hasAccessByCodes } = useAccess();
const user = useUserStore();
const can = (code: string) => hasAccessByCodes([`sysPrint:${code}`]);
const isSuperAdmin = computed(() => user.userInfo?.accountType === 999);
const SearchIcon = createIconifyIcon('lucide:search');
const Pencil = createIconifyIcon('lucide:pencil');
const RotateIcon = createIconifyIcon('lucide:rotate-ccw');
const PrinterIcon = createIconifyIcon('lucide:printer');
const TrashIcon = createIconifyIcon('lucide:trash-2');
const formRef = ref<FormInstance>();
const designerHost = ref<HTMLElement>();
const designer = shallowRef<Designer>();
const designerOpen = ref(false);
const saving = ref(false);
const outputBusy = ref(false);
const designerLoading = ref(false);
const designerError = ref('');
const preset = ref('document');
let operation: AbortController | undefined;
const busy = computed(() => saving.value || outputBusy.value || designerLoading.value);
const tenants = ref<Array<{ label: string; value: number | string }>>([]);
const filters = reactive({ name: '', tenantId: isSuperAdmin.value ? user.userInfo?.currentTenantId : undefined });
const value = ref<PrintRecord>(newRecord());
const designerGeneration = ref(0);

function newRecord(): PrintRecord {
	return {
		name: '',
		orderNo: 100,
		printDataDemo: JSON.stringify([{ code: 'DEMO-001', name: '示例数据', printedAt: new Date().toLocaleString('zh-CN') }], null, 2),
		printParam: JSON.stringify({ copies: 1, title: '打印任务' }, null, 2),
		printType: 1,
		status: 1,
		template: JSON.stringify(createDefaultTemplate()),
	};
}

const table = useAdminTable<PrintRecord, typeof filters>({
	query: { ...filters },
	load: async (query, signal) =>
		listPrintTemplates({ name: query.name, page: query.page, pageSize: query.pageSize, tenantId: query.tenantId }, signal) as Promise<{ items: PrintRecord[]; total: number }>,
});
const columns: NonNullable<TableProps<PrintRecord>['columns']> = [
	{ title: '名称', dataIndex: 'name', key: 'name', width: 220 },
	{ title: '打印方式', key: 'printType', width: 110 },
	{ title: '状态', key: 'status', width: 90 },
	{ title: '排序', dataIndex: 'orderNo', key: 'orderNo', width: 90 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 150 },
];

function reset() {
	filters.name = '';
	void table.search({ ...filters });
}

function edit(record?: PrintRecord) {
	if (busy.value || !can(record ? 'update' : 'add')) return;
	designerGeneration.value += 1;
	value.value = record ? structuredClone(record) : { ...newRecord(), tenantId: filters.tenantId };
	designerOpen.value = true;
}

function destroyDesigner() {
	designer.value?.destroy();
	designer.value = undefined;
}

async function mountDesigner() {
	designerLoading.value = true;
	designerError.value = '';
	const generation = designerGeneration.value;
	try {
		await nextTick();
		if (!designerHost.value) return;
		const record = value.value;
		const template = parsePdfmeTemplate(record.template);
		const options = await loadPdfmeOptions();
		if (!designerOpen.value || value.value !== record || generation !== designerGeneration.value || !designerHost.value) return;
		destroyDesigner();
		designer.value = new Designer({
			domContainer: designerHost.value,
			options: { ...options, sidebarOpen: true, zoomLevel: 1 },
			plugins: pdfmePlugins,
			template,
		});
	} catch (error) {
		if (generation === designerGeneration.value) designerError.value = error instanceof Error ? error.message : '设计器加载失败';
	} finally {
		if (generation === designerGeneration.value) designerLoading.value = false;
	}
}

watch(designerOpen, (open) => {
	if (open) void mountDesigner();
	else {
		designerGeneration.value += 1;
		operation?.abort();
		designerLoading.value = false;
		destroyDesigner();
	}
});

function applyPreset() {
	if (busy.value) return;
	Modal.confirm({
		title: '替换当前设计及预览数据？',
		onOk: async () => {
			if (!designerOpen.value || busy.value) return;
			const template = preset.value === 'table' ? createTableTemplate([['商品', '数量', '金额']], '商品清单') : createDefaultTemplate();
			if (preset.value === 'label') {
				template.basePdf = { width: 100, height: 80, padding: [5, 5, 5, 5] };
				for (const schema of template.schemas[0] ?? []) {
					schema.width = 80;
					schema.position.x = 5;
				}
			}
			value.value.template = JSON.stringify(template);
			value.value.printDataDemo = preset.value === 'table' ? JSON.stringify([{ rows: JSON.stringify([['示例商品', '2', '100.00']]) }], null, 2) : newRecord().printDataDemo;
			designerGeneration.value += 1;
			destroyDesigner();
			await mountDesigner();
		},
	});
}

function updateParameter(key: 'copies' | 'title', entry: null | number | string) {
	try {
		value.value.printParam = JSON.stringify({ ...parsePrintParameters(value.value.printParam), [key]: entry }, null, 2);
	} catch (error) {
		message.error((error as Error).message);
	}
}
const parameters = computed(() => {
	try {
		return parsePrintParameters(value.value.printParam);
	} catch {
		return { copies: undefined, title: '' };
	}
});

async function preview() {
	await executeOutput(false);
}
async function print() {
	await executeOutput(true);
}

async function executeOutput(execute: boolean) {
	if (busy.value || designerError.value || !can(value.value.id ? 'update' : 'add')) return;
	const record = value.value;
	const version = sessionBoundary.version;
	const controller = new AbortController();
	operation = controller;
	sessionBoundary.track(controller);
	const current = () => !controller.signal.aborted && designerOpen.value && value.value === record && version === sessionBoundary.version;
	outputBusy.value = true;
	try {
		const template = designer.value?.getTemplate() ?? parsePdfmeTemplate(record.template);
		const inputs = parsePdfmeInputs(record.printDataDemo);
		const options = parsePrintParameters(record.printParam);
		if (!execute) await previewPdf(template, inputs, current);
		else if (record.printType === 2) {
			await sendToPrintService(template, inputs, { ...options, clientServiceAddress: record.clientServiceAddress, signal: controller.signal });
			if (current()) message.success('已提交到打印服务');
		} else await printPdf(template, inputs, current);
	} catch (error) {
		if (current()) message.error(error instanceof Error ? error.message : '输出失败');
	} finally {
		sessionBoundary.release(controller);
		outputBusy.value = false;
	}
}

async function save() {
	if (busy.value || designerError.value || !can(value.value.id ? 'update' : 'add')) return;
	saving.value = true;
	const record = value.value;
	const version = sessionBoundary.version;
	try {
		await formRef.value?.validate();
		if (!designerOpen.value || record !== value.value || version !== sessionBoundary.version) return;
		const template: Template = designer.value?.getTemplate() ?? parsePdfmeTemplate(value.value.template);
		parsePdfmeInputs(value.value.printDataDemo);
		parsePrintParameters(value.value.printParam);
		await savePrintTemplate({ ...value.value, template: JSON.stringify(template) } as AddPrintInput | UpdatePrintInput);
		if (version !== sessionBoundary.version || record !== value.value) return;
		message.success('保存成功');
		designerOpen.value = false;
		await table.reload();
	} catch (error) {
		if (error instanceof Error && version === sessionBoundary.version) message.error(error.message);
	} finally {
		saving.value = false;
	}
}

async function remove(record: PrintRecord) {
	if (!record.id) return;
	await removePrintTemplate(record.id);
	message.success('删除成功');
	await table.reload();
}

function closeEditor() {
	operation?.abort();
	designerOpen.value = false;
	destroyDesigner();
}
onBeforeUnmount(closeEditor);
onDeactivated(closeEditor);
void (async () => {
	if (isSuperAdmin.value) tenants.value = (await getTenantOptionsApi()) as typeof tenants.value;
	await table.reload();
})();
</script>

<template>
	<div class="print-page">
		<Form :model="filters" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem v-if="isSuperAdmin" label="租户"><Select v-model:value="filters.tenantId" :options="tenants" allow-clear class="tenant-select" /></FormItem>
			<FormItem label="模板名称"><Input v-model:value="filters.name" allow-clear /></FormItem>
			<div class="query-actions">
				<Button v-if="can('page')" type="primary" html-type="submit"><SearchIcon :size="16" />查询</Button>
				<Button @click="reset"><RotateIcon :size="16" />重置</Button>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns" :pagination="true">
			<template #toolbar
				><Button v-if="can('add')" type="primary" @click="edit()"><Plus :size="16" />新增模板</Button></template
			>
			<template #bodyCell="{ column, record }">
				<template v-if="column.key === 'printType'">{{ record.printType === 2 ? '客户端服务' : '浏览器 PDF' }}</template>
				<Tag v-else-if="column.key === 'status'" :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '启用' : '禁用' }}</Tag>
				<div v-else-if="column.key === 'actions'" class="row-actions">
					<Tooltip v-if="can('update')" title="编辑"
						><Button type="text" size="small" aria-label="编辑模板" @click="edit(record)"><Pencil :size="16" /></Button
					></Tooltip>
					<Popconfirm v-if="can('delete')" :title="`确定删除模板“${record.name}”？`" @confirm="remove(record)">
						<Button danger type="text" size="small" aria-label="删除模板"><TrashIcon :size="16" /></Button>
					</Popconfirm>
				</div>
			</template>
		</AdminTable>
		<Modal
			v-model:open="designerOpen"
			:title="value.id ? '编辑打印模板' : '新增打印模板'"
			:width="1280"
			:confirm-loading="saving"
			:closable="!busy"
			:keyboard="!busy"
			:cancel-button-props="{ disabled: busy }"
			:ok-button-props="{ disabled: busy || !!designerError }"
			:mask-closable="false"
			class="print-modal"
			@ok="save"
		>
			<div class="editor-grid">
				<Form ref="formRef" :model="value" layout="vertical" class="settings-form">
					<FormItem label="常用模板"
						><Select
							v-model:value="preset"
							:options="[
								{ label: 'A4 文档', value: 'document' },
								{ label: '商品清单', value: 'table' },
								{ label: '100 × 80 标签', value: 'label' },
							]"
						/><Button :disabled="busy" @click="applyPreset"><RotateIcon :size="16" />应用模板</Button></FormItem
					>
					<p v-if="designerError" role="alert">{{ designerError }}</p>
					<FormItem label="模板名称" name="name" :rules="[{ required: true, message: '请输入模板名称' }]"><Input v-model:value="value.name" /></FormItem>
					<FormItem label="排序"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
					<FormItem label="状态"><Switch v-model:checked="value.status" :checked-value="1" :un-checked-value="2" /></FormItem>
					<FormItem label="打印方式"
						><RadioGroup
							v-model:value="value.printType"
							:options="[
								{ label: '浏览器 PDF', value: 1 },
								{ label: '客户端服务', value: 2 },
							]"
					/></FormItem>
					<FormItem v-if="value.printType === 2" name="clientServiceAddress" label="客户端服务地址"><Input v-model:value="value.clientServiceAddress" placeholder="http://127.0.0.1:xxxx" /></FormItem>
					<FormItem name="printParam" label="打印参数"><TextArea v-model:value="value.printParam" :rows="4" /></FormItem>
					<FormItem label="任务标题"><Input aria-label="任务标题" :value="parameters.title" :maxlength="200" @update:value="updateParameter('title', $event)" /></FormItem>
					<FormItem v-if="value.printType === 2" label="打印份数"
						><InputNumber aria-label="打印份数" :value="parameters.copies" :min="1" :max="100" :precision="0" @update:value="updateParameter('copies', $event)"
					/></FormItem>
					<FormItem name="printDataDemo" label="预览数据"><TextArea v-model:value="value.printDataDemo" :rows="8" /></FormItem>
					<FormItem label="备注"><TextArea v-model:value="value.remark" :rows="3" /></FormItem>
					<div class="form-actions">
						<Button :disabled="busy || !!designerError" @click="preview"><PrinterIcon :size="16" />预览 PDF</Button>
						<Button :loading="outputBusy" :disabled="busy || !!designerError" type="primary" @click="print"><PrinterIcon :size="16" />执行打印</Button>
					</div>
				</Form>
				<div ref="designerHost" class="designer-host" />
			</div>
		</Modal>
	</div>
</template>

<style scoped>
.print-page {
	padding: 16px;
	min-width: 0;
}
.query-form,
.query-actions,
.row-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}
.tenant-select {
	min-width: 180px;
}
.editor-grid {
	display: grid;
	grid-template-columns: minmax(270px, 340px) minmax(0, 1fr);
	gap: 16px;
	height: min(720px, calc(100vh - 230px));
	min-height: 400px;
}
.settings-form {
	overflow: auto;
	padding-right: 4px;
}
.designer-host {
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	border: 1px solid var(--ant-color-border);
}
.form-actions {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}
@media (max-width: 960px) {
	.editor-grid {
		grid-template-columns: 1fr;
	}
	.designer-host {
		min-height: 560px;
	}
}
</style>
