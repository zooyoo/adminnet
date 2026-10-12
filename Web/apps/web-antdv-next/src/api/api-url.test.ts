import { describe, expect, it } from 'vitest';

import { noticeResourceUrl } from '../components/notice-editor/resource-url';
import { normalizeApiUrl } from './api-url';
import { onlineHubUrl } from './online-session';

describe('运行时 API 挂载地址', () => {
	it.each([['', ''], ['/', ''], ['prod-api', '/prod-api'], [' /prod-api/// ', '/prod-api'], ['https://api.example.test/gateway/', 'https://api.example.test/gateway'], ['//api.example.test/gateway/', '//api.example.test/gateway']])('统一相对或绝对根目录 %s', (value, expected) => {
		expect(normalizeApiUrl(value)).toBe(expected);
	});
	it.each(['/prod-api', 'prod-api/', 'https://api.example.test/prod-api/'])('Hub 与上传资源只拼一次挂载路径 %s', (base) => {
		const resolved = new URL(normalizeApiUrl(base) || '/', 'https://app.example.test').href.replace(/\/+$/u, '');
		expect(new URL(onlineHubUrl(base), 'https://app.example.test').href).toBe(resolved + '/hubs/onlineUser');
		expect(noticeResourceUrl('/upload/file.png', base, 'https://app.example.test')).toBe(resolved + '/upload/file.png');
		expect(noticeResourceUrl('/prod-api/upload/file.png', base, 'https://app.example.test')).toBe(resolved + '/upload/file.png');
	});
	it.each(['javascript:alert(1)', 'https://api.example.test/?token=secret', 'https://user:secret@api.example.test', '/prod-api#hash', '/prod-api\\api', '/prod api'])('拒绝非服务地址并不回显配置 %s', (value) => {
		expect(() => normalizeApiUrl(value)).toThrow(/API 地址/u);
		try { normalizeApiUrl(value); } catch (error) { expect(String(error)).not.toContain(value); }
	});
});
