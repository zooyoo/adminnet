import type { Template } from '@pdfme/common';

import { text } from '@pdfme/schemas';

export const pdfmePlugins = { text };

export function createDefaultTemplate(): Template {
	return {
		basePdf: { height: 297, padding: [12, 12, 12, 12], width: 210 },
		schemas: [
			[
				{
					content: '打印清单',
					height: 12,
					name: 'title',
					position: { x: 12, y: 16 },
					type: 'text',
					width: 120,
				},
				{
					content: '编号：{{code}}',
					height: 8,
					name: 'code',
					position: { x: 12, y: 36 },
					type: 'text',
					width: 100,
				},
				{
					content: '名称：{{name}}',
					height: 8,
					name: 'name',
					position: { x: 12, y: 48 },
					type: 'text',
					width: 140,
				},
				{
					content: '打印时间：{{printedAt}}',
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

export function parsePdfmeTemplate(value?: string | null): Template {
	if (!value) return createDefaultTemplate();
	try {
		return JSON.parse(value) as Template;
	} catch {
		return createDefaultTemplate();
	}
}

export function parsePdfmeInputs(value?: string | null): Record<string, string>[] {
	if (!value) return [{ code: 'DEMO-001', name: '示例数据', printedAt: new Date().toLocaleString('zh-CN') }];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		return [{ code: 'DEMO-001', name: '示例数据', printedAt: new Date().toLocaleString('zh-CN') }];
	}
}
