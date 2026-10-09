import { resolveReadOnlyContent } from '@pdfme/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultTemplate, parsePdfmeInputs, parsePdfmeTemplate } from './template';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('pdfme template contracts', () => {
	it('preserves static headings and resolves Chinese field labels', () => {
		const template = createDefaultTemplate();
		const values = template.schemas[0]!.map((schema) => resolveReadOnlyContent({ schema, variables: { code: 'DEMO', name: '中文', printedAt: '2026-10-09' }, schemas: template.schemas }));
		expect(values).toEqual(['打印清单', '编号：DEMO', '名称：中文', '打印时间：2026-10-09']);
	});
	it('does not replace damaged persisted templates with a sample', () => {
		for (const value of [undefined, '', '{', '{}', '{"panels":[]}']) expect(() => parsePdfmeTemplate(value)).toThrow('打印模板');
		expect(parsePdfmeTemplate(JSON.stringify(createDefaultTemplate()))).toEqual(createDefaultTemplate());
	});
	it('rejects invalid input without inventing sample data', () => {
		for (const value of [undefined, '{', 'null', '[]', '[null]', '[{"name":1}]']) expect(() => parsePdfmeInputs(value)).toThrow('预览数据');
		expect(parsePdfmeInputs('{"name":"中文"}')).toEqual([{ name: '中文' }]);
	});
	it('loads binary font data once and retries after a failed load', async () => {
		const font = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0]);
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
			.mockResolvedValue(new Response(font));
		vi.stubGlobal('fetch', fetcher);
		const { loadPdfmeOptions } = await import('./template');
		await expect(loadPdfmeOptions()).rejects.toThrow('字体加载失败');
		const [first, second] = await Promise.all([loadPdfmeOptions(), loadPdfmeOptions()]);
		expect(first).toBe(second);
		expect(first.font?.SourceHanSerifSC?.data).toBeInstanceOf(ArrayBuffer);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});
