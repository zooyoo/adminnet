import { describe, expect, it } from 'vitest';

import { noticeResourceUrl } from './resource-url';

describe('notice image resource URL', () => {
	it.each([
		['/upload/image.png', '/prod-api', 'http://localhost/prod-api/upload/image.png'],
		['upload/image.png', '/prod-api/', 'http://localhost/prod-api/upload/image.png'],
		['/prod-api/upload/image.png', '/prod-api', 'http://localhost/prod-api/upload/image.png'],
		['/upload/image.png', 'https://api.example.test/gateway/', 'https://api.example.test/gateway/upload/image.png'],
		['https://cdn.example.test/image.png', '/prod-api', 'https://cdn.example.test/image.png'],
		['/upload/image.png', '', 'http://localhost/upload/image.png'],
	])('resolves %s against %s without duplicated prefixes', (value, root, expected) => {
		expect(noticeResourceUrl(value, root, 'http://localhost')).toBe(expected);
	});

	it.each(['', 'javascript:alert(1)', 'data:image/svg+xml,test', 'file:///private.png', '\\\\host\\image'])('rejects invalid resource %s', (value) => {
		expect(() => noticeResourceUrl(value, '/prod-api', 'http://localhost')).toThrow('图片地址无效');
	});
});
