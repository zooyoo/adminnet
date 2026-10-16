import type { ColumnOuput } from '#/api-services/models/column-ouput';
import type { SysMenu } from '#/api-services/models/sys-menu';
import type { TableUniqueConfigItem } from '#/api-services/models/table-unique-config-item';
import type { CodeGenDraft, CodeGenField, CodeGenRow } from '#/api/system/codegen';

export const FIELD_FLAGS = ['whetherTable', 'whetherAddUpdate', 'whetherImport', 'whetherRequired', 'whetherSortable', 'whetherQuery', 'whetherRetract'] as const;
export type FieldFlag = (typeof FIELD_FLAGS)[number];
export const SELECTOR_TYPES = ['Radio', 'Checkbox', 'DictSelector', 'EnumSelector', 'ConstSelector'];
export const FOREIGN_TYPES = ['ForeignKey', 'ApiTreeSelector'];

export function createCodeGenDraft(row?: CodeGenRow): CodeGenDraft {
	return {
		configId: '', menuIcon: 'ele-Menu', pagePath: 'main', printType: 'off', printName: '', tablePrefix: '',
		...row,
		authorName: row?.authorName ?? 'Admin.NET', tableName: row?.tableName ?? '', busName: row?.busName ?? '', nameSpace: row?.nameSpace ?? '', generateType: row?.generateType ?? '200', generateMenu: row?.generateMenu ?? true,
		tableUniqueList: row?.tableUniqueList?.map((item) => ({ columns: [...(item.columns ?? [])], message: item.message ?? '' })) ?? [],
	};
}

export function copyCodeGenDraft(row: CodeGenRow): CodeGenDraft {
	return { ...createCodeGenDraft(row), id: undefined, tableName: '', busName: '', tableUniqueList: [] };
}
export function changeCodeGenParent(draft: CodeGenDraft, value: unknown, menus: readonly Pick<SysMenu, 'id' | 'name'>[]) {
	draft.menuPid = Number(value);
	// 旧版按菜单 name 推导目录，不使用路由 path 或菜单标题。
	draft.pagePath = menus.find((menu) => menu.id === draft.menuPid)?.name ?? '';
}

export function fillCodeGenUniqueMessage(item: TableUniqueConfigItem, value: unknown, columns: readonly Pick<ColumnOuput, 'columnComment' | 'propertyName'>[]) {
	if (Array.isArray(value) && value.length === 1 && !item.message) {
		item.message = columns.find((column) => column.propertyName === value[0])?.columnComment ?? '';
	}
}

export function cloneFields(fields: CodeGenField[]) {
	return fields.map((field) => {
		const result = { ...field, fkDisplayColumnList: [...(field.fkDisplayColumnList ?? [])] };
		for (const key of FIELD_FLAGS) if (!result[key]) result[key] = 'N';
		return result;
	});
}

export function isFieldFlag(key: unknown): key is FieldFlag {
	return typeof key === 'string' && FIELD_FLAGS.some((flag) => flag === key);
}
export function protectedField(field: CodeGenField) {
	return field.whetherCommon === 'Y' || field.columnKey === 'True';
}

export function validateCodeGenDraft(draft: CodeGenDraft) {
	if (!draft.configId || !draft.tableName) return '请选择数据库和实体。';
	if (!draft.authorName?.trim()) return '请填写作者。';
	if (!draft.busName?.trim()) return '请填写业务名称。';
	if (!draft.nameSpace?.trim()) return '请选择应用命名空间。';
	if (!draft.generateType) return '请选择生成方式。';
	if (draft.printType === 'custom' && !draft.printName?.trim()) return '请选择自定义打印模板。';
	if (draft.generateMenu && !draft.pagePath?.trim()) return '请填写菜单页面目录。';
	if (draft.tableUniqueList.some((item) => !item.columns?.length || !item.message?.trim())) return '唯一约束需要字段和校验提示。';
	return '';
}

export function validateCodeGenFields(fields: CodeGenField[]) {
	if (!fields.length) return '当前实体没有可保存字段，请同步后重试。';
	const ids = new Set<string>();
	const codeGenId = String(fields[0]?.codeGenId);
	for (const field of fields) {
		if (!field.id || !field.codeGenId || String(field.codeGenId) !== codeGenId || ids.has(String(field.id))) return '字段身份不一致，请关闭配置并重新加载。';
		ids.add(String(field.id));
		if (FIELD_FLAGS.some((key) => !['N', 'Y'].includes(String(field[key])))) return `${field.propertyName} 的字段开关无效。`;
		if (!Number.isInteger(field.orderNo) || Number(field.orderNo) < 0 || Number(field.orderNo) > 1_000_000) return `${field.propertyName} 的排序应为 0 到 1000000 的整数。`;
		if (FOREIGN_TYPES.includes(field.effectType ?? '')) {
			if (!field.fkConfigId || !field.fkEntityName || !field.fkTableName || !field.fkLinkColumnName || !field.fkDisplayColumnList?.length) return `${field.propertyName} 的关联表配置不完整。`;
			if (field.effectType === 'ApiTreeSelector' && !field.pidColumn) return `${field.propertyName} 的树选择器需要父级字段。`;
		}
	}
	return '';
}

export function redactedConnection(value?: null | string) {
	return (value ?? '').replaceAll(/((?:password|pwd)\s*=\s*)(?:"[^"]*"|'[^']*'|[^;]*)/gi, '$1[已隐藏]');
}
