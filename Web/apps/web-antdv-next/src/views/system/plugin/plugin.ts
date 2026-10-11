import type { PluginDraft, PluginId, PluginRow } from '#/api/system/plugin';

export function createPluginDraft(row?: PluginRow, tenantId?: PluginId): PluginDraft {
	// 只复制业务字段，避免把列表中的审计字段或旧会话数据送回服务端。
	return {
		...(row ? { id: row.id } : {}),
		name: row?.name ?? '',
		assemblyName: row?.assemblyName ?? '',
		csharpCode: row?.csharpCode ?? '',
		orderNo: row?.orderNo ?? 100,
		status: row?.status ?? 1,
		remark: row?.remark ?? '',
		tenantId: row?.tenantId ?? tenantId,
	};
}

export function validatePluginDraft(draft: PluginDraft): Partial<Record<keyof PluginDraft, string>> {
	const errors: Partial<Record<keyof PluginDraft, string>> = {};
	if (!draft.name.trim() || draft.name.length > 64) errors.name = '功能名称不能为空且不能超过 64 个字符';
	if (!draft.csharpCode.trim()) errors.csharpCode = '请输入 C# 代码';
	if (draft.assemblyName.length > 512) errors.assemblyName = '程序集名称不能超过 512 个字符';
	if (draft.remark.length > 128) errors.remark = '备注不能超过 128 个字符';
	if (!Number.isInteger(draft.orderNo) || draft.orderNo < -2_147_483_648 || draft.orderNo > 2_147_483_647) errors.orderNo = '排序必须是有效的 32 位整数';
	if (draft.status !== 1 && draft.status !== 2) errors.status = '请选择启用或禁用';
	return errors;
}

export function pluginPayload(draft: PluginDraft): PluginDraft {
	return {
		...(draft.id === undefined ? {} : { id: draft.id }),
		name: draft.name.trim(),
		assemblyName: draft.assemblyName.trim(),
		// 代码内容不 trim、不格式化，确保取消与保存后重开时原文一致。
		csharpCode: draft.csharpCode,
		orderNo: draft.orderNo,
		status: draft.status,
		remark: draft.remark,
		tenantId: draft.tenantId,
	};
}
