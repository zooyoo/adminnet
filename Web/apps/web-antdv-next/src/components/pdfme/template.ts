import type { CommonOptions, Template } from '@pdfme/common';

import { checkInputs, checkTemplate } from '@pdfme/common';
import { table, text } from '@pdfme/schemas';

export const pdfmePlugins = { table, text };

export function createTableTemplate(matrix: Array<Array<boolean | number | string>>, title: string): Template {
	const head = (matrix[0] ?? []).map(String);
	if (head.length === 0) throw new Error('请至少选择一列数据');
	const schema = structuredClone(table.propPanel.defaultSchema);
	return {
		basePdf: { width: 297, height: 210, padding: [12, 12, 12, 12] },
		schemas: [
			[
				{ name: 'title', type: 'text', content: title, readOnly: true, fontName: 'SourceHanSerifSC', fontSize: 16, position: { x: 12, y: 12 }, width: 273, height: 12 },
				{
					...schema,
					name: 'rows',
					position: { x: 12, y: 28 },
					width: 273,
					head,
					headWidthPercentages: head.map(() => 100 / head.length),
					repeatHead: true,
					headStyles: { ...schema.headStyles, fontName: 'SourceHanSerifSC' },
					bodyStyles: { ...schema.bodyStyles, fontName: 'SourceHanSerifSC' },
				},
			],
		],
	};
}
let optionsPromise: Promise<CommonOptions> | undefined;

export function loadPdfmeOptions(): Promise<CommonOptions> {
	optionsPromise ??= (async () => {
		const response = await fetch(`${import.meta.env.BASE_URL ?? '/'}fonts/source-han-serif-sc/SourceHanSerifSC-Regular.otf`, { signal: AbortSignal.timeout(30_000) });
		if (!response.ok) throw new Error('打印字体加载失败');
		const data = await response.arrayBuffer();
		const signature = new DataView(data).getUint32(0);
		if (signature !== 0x4f54544f && signature !== 0x00010000) throw new Error('打印字体格式无效');
		return { font: { SourceHanSerifSC: { data, fallback: true, subset: true } } };
	})().catch((error: unknown) => {
		optionsPromise = undefined;
		throw error;
	});
	return optionsPromise;
}

export function createDefaultTemplate(): Template {
	return {
		basePdf: { height: 297, padding: [12, 12, 12, 12], width: 210 },
		schemas: [
			[
				{
					content: '打印清单',
					readOnly: true,
					fontName: 'SourceHanSerifSC',
					height: 12,
					name: 'title',
					position: { x: 12, y: 16 },
					type: 'text',
					width: 120,
				},
				{
					content: '编号：{code}',
					readOnly: true,
					fontName: 'SourceHanSerifSC',
					height: 8,
					name: 'code',
					position: { x: 12, y: 36 },
					type: 'text',
					width: 100,
				},
				{
					content: '名称：{name}',
					readOnly: true,
					fontName: 'SourceHanSerifSC',
					height: 8,
					name: 'name',
					position: { x: 12, y: 48 },
					type: 'text',
					width: 140,
				},
				{
					content: '打印时间：{printedAt}',
					readOnly: true,
					fontName: 'SourceHanSerifSC',
					height: 8,
					name: 'printedAt',
					position: { x: 12, y: 60 },
					type: 'text',
					width: 140,
				},
			],
		],
	};
}

export function parsePdfmeTemplate(value?: null | string): Template {
	try {
		if (!value) throw new Error('empty');
		const template: unknown = JSON.parse(value);
		checkTemplate(template);
		return template as Template;
	} catch {
		throw new Error('打印模板损坏或格式不兼容，请修复模板后重试');
	}
}

export function parsePdfmeInputs(value?: null | string): Record<string, string>[] {
	try {
		const parsed: unknown = JSON.parse(value ?? 'null');
		const inputs = Array.isArray(parsed) ? parsed : [parsed];
		checkInputs(inputs);
		if (inputs.some((row) => !row || typeof row !== 'object' || Object.values(row).some((cell) => typeof cell !== 'string'))) throw new Error('invalid');
		return inputs as Record<string, string>[];
	} catch {
		throw new Error('预览数据必须是非空 JSON 对象数组，字段值必须是字符串');
	}
}
