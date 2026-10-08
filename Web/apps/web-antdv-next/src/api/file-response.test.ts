import type { AxiosResponse } from 'axios';

import { AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { decodeFileResponse, responseFileName } from './file-response';

function response(data: string, type: string, disposition = ''): AxiosResponse<ArrayBuffer> {
	return { data: new TextEncoder().encode(data).buffer, headers: { 'content-type': type, 'content-disposition': disposition }, status: 200, statusText: 'OK', config: { headers: new AxiosHeaders() } };
}
describe('file response decoding', () => {
	it('distinguishes successful JSON imports from binary error reports', async () => {
		await expect(decodeFileResponse(response('{"code":200,"message":"导入成功"}', 'application/json'), 'fallback.xlsx')).resolves.toEqual({ kind: 'success', message: '导入成功' });
		const file = await decodeFileResponse(
			response('binary', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `attachment; filename*=UTF-8''%E9%94%99%E8%AF%AF.xlsx`),
			'fallback.xlsx'
		);
		expect(file.kind).toBe('file');
		if (file.kind === 'file') expect(file.file.fileName).toBe('错误.xlsx');
	});
	it('does not download JSON business errors as spreadsheets', async () => {
		await expect(decodeFileResponse(response('{"code":400,"message":"数据格式错误"}', 'application/problem+json'), 'export.xlsx')).rejects.toThrow('数据格式错误');
	});
	it('sanitizes server filenames and handles malformed encoding', () => {
		const sanitized = responseFileName('attachment; filename="../../outside.xlsx"', 'fallback.xlsx');
		expect(sanitized).not.toMatch(/[\\/]/);
		expect(sanitized).not.toMatch(/^\./);
		expect(responseFileName("attachment; filename*=UTF-8''%ZZ", 'fallback.xlsx')).toBe('fallback.xlsx');
		expect(responseFileName('', '默认.xlsx')).toBe('默认.xlsx');
	});
});
