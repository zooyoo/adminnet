<script setup lang="ts">
import type { Template } from '@pdfme/common';
import type { FormInstance, TableProps } from 'antdv-next';
import type { AddPrintInput, SysPrint, UpdatePrintInput } from '#/api-services/models';

import { Designer } from '@pdfme/ui';
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus } from '@vben/icons';
import { useUserStore } from '@vben/stores';
import { Button, Form, FormItem, Input, InputNumber, message, Modal, Popconfirm, RadioGroup, Select, Switch, Tag, TextArea, Tooltip } from 'antdv-next';

import { getTenantOptionsApi } from '#/api';
import { listPrintTemplates, removePrintTemplate, savePrintTemplate } from '#/api/system/print';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import { createDefaultTemplate, parsePdfmeInputs, parsePdfmeTemplate, pdfmePlugins } from '#/components/pdfme/template';

defineOptions({ name: 'SysPrint' });

type PrintRecord = SysPrint & Record<string, unknown>;
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
const tenants = ref<Array<{ label: string; value: number | string }>>([]);
const filters = reactive({ name: '', tenantId: isSuperAdmin.value ? user.userInfo?.currentTenantId : undefined });
const value = ref<PrintRecord>(newRecord());

function newRecord(): PrintRecord {
	return {
		name: '',
		orderNo: 100,
		printDataDemo: JSON.stringify([{ code: 'DEMO-001', name: '示例数据', printedAt: new Date().toLocaleString('zh-CN') }], null, 2),
		printParam: JSON.stringify({ autoPrint: false, copies: 1, title: '打印任务' }, null, 2),
		printType: 1,
		status: 1,
		template: JSON.stringify(createDefaultTemplate()),
	};
}

const table = useAdminTable<PrintRecord, typeof filters>({
	query: { ...filters },
	load: async (query, signal) => listPrintTemplates({ name: query.name, page: 1, pageSize: 100, tenantId: query.tenantId }, signal) as Promise<{ items: PrintRecord[]; total: number }>,
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
	value.value = record ? structuredClone(record) : { ...newRecord(), tenantId: filters.tenantId };
	designerOpen.value = true;
}

function destroyDesigner() {
	designer.value?.destroy();
	designer.value = undefined;
}

async function mountDesigner() {
	await nextTick();
	if (!designerHost.value) return;
	destroyDesigner();
	designer.value = new Designer({
		domContainer: designerHost.value,
		options: { sidebarOpen: true, zoomLevel: 1 },
		plugins: pdfmePlugins,
		template: parsePdfmeTemplate(value.value.template),
	});
}

watch(designerOpen, (open) => {
	if (open) void mountDesigner();
	else destroyDesigner();
});

async function preview() {
	try {
		const template = designer.value?.getTemplate() ?? parsePdfmeTemplate(value.value.template);
		const { generate } = await import('@pdfme/generator');
		const pdf = await generate({ inputs: parsePdfmeInputs(value.value.printDataDemo), plugins: pdfmePlugins, template });
		const url = URL.createObjectURL(new Blob([pdf.buffer], { type: 'application/pdf' }));
		window.open(url, '_blank', 'noopener,noreferrer');
		window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
	} catch (error) {
		message.error(error instanceof Error ? error.message : 'PDF 预览失败');
	}
}

async function save() {
	if (saving.value) return;
	try {
		await formRef.value?.validate();
		const template: Template = designer.value?.getTemplate() ?? parsePdfmeTemplate(value.value.template);
		JSON.parse(value.value.printDataDemo ?? '[]');
		JSON.parse(value.value.printParam ?? '{}');
		saving.value = true;
		await savePrintTemplate({ ...value.value, template: JSON.stringify(template) } as AddPrintInput | UpdatePrintInput);
		message.success('保存成功');
		designerOpen.value = false;
		await table.reload();
	} catch (error) {
		if (error instanceof SyntaxError) message.error('打印数据或打印参数必须是有效 JSON');
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

onBeforeUnmount(destroyDesigner);
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
		<AdminTable :controller="table" :columns="columns" :pagination="false">
			<template #toolbar><Button v-if="can('add')" type="primary" @click="edit()"><Plus :size="16" />新增模板</Button></template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.key === 'printType'">{{ record.printType === 2 ? '客户端服务' : '浏览器 PDF' }}</template>
				<Tag v-else-if="column.key === 'status'" :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '启用' : '禁用' }}</Tag>
				<div v-else-if="column.key === 'actions'" class="row-actions">
					<Tooltip v-if="can('update')" title="编辑"><Button type="text" size="small" aria-label="编辑模板" @click="edit(record)"><Pencil :size="16" /></Button></Tooltip>
					<Popconfirm v-if="can('delete')" :title="`确定删除模板“${record.name}”？`" @confirm="remove(record)">
						<Button danger type="text" size="small" aria-label="删除模板"><TrashIcon :size="16" /></Button>
					</Popconfirm>
				</div>
			</template>
		</AdminTable>
		<Modal v-model:open="designerOpen" :title="value.id ? '编辑打印模板' : '新增打印模板'" :width="1280" :confirm-loading="saving" :mask-closable="false" class="print-modal" @ok="save">
			<div class="editor-grid">
				<Form ref="formRef" :model="value" layout="vertical" class="settings-form">
					<FormItem label="模板名称" name="name" :rules="[{ required: true, message: '请输入模板名称' }]"><Input v-model:value="value.name" /></FormItem>
					<FormItem label="排序"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
					<FormItem label="状态"><Switch v-model:checked="value.status" :checked-value="1" :un-checked-value="2" /></FormItem>
					<FormItem label="打印方式"><RadioGroup v-model:value="value.printType" :options="[{ label: '浏览器 PDF', value: 1 }, { label: '客户端服务', value: 2 }]" /></FormItem>
					<FormItem v-if="value.printType === 2" label="客户端服务地址"><Input v-model:value="value.clientServiceAddress" placeholder="http://127.0.0.1:xxxx" /></FormItem>
					<FormItem label="打印参数"><TextArea v-model:value="value.printParam" :rows="4" /></FormItem>
					<FormItem label="预览数据"><TextArea v-model:value="value.printDataDemo" :rows="8" /></FormItem>
					<FormItem label="备注"><TextArea v-model:value="value.remark" :rows="3" /></FormItem>
					<Button @click="preview"><PrinterIcon :size="16" />预览 PDF</Button>
				</Form>
				<div ref="designerHost" class="designer-host" />
			</div>
		</Modal>
	</div>
</template>

<style scoped>
.print-page { padding: 16px; min-width: 0; }
.query-form, .query-actions, .row-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tenant-select { min-width: 180px; }
.editor-grid { display: grid; grid-template-columns: minmax(270px, 340px) minmax(0, 1fr); gap: 16px; min-height: 680px; }
.settings-form { overflow: auto; padding-right: 4px; }
.designer-host { min-width: 0; min-height: 680px; border: 1px solid var(--ant-color-border); }
@media (max-width: 960px) { .editor-grid { grid-template-columns: 1fr; } .designer-host { min-height: 560px; } }
</style>
