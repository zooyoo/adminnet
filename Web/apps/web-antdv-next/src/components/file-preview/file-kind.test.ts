import { describe, expect, it } from 'vitest';

import { fileKind, uploadError } from './file-kind';

describe('文件类型与上传边界', () => {
	it.each([
		['.DOCX', 'docx'],
		['.XLSX', 'excel'],
		['.xls', 'excel'],
		['.pdf', 'pdf'],
		['.png', 'image'],
		['.jpeg', 'image'],
		['.webm', 'video'],
		['.mp4', 'video'],
		['.wav', 'audio'],
		['.mp3', 'audio'],
		['.html', 'unsupported'],
		['.doc', 'unsupported'],
	])('按扩展名 %s 选择引擎 %s', (suffix, expected) => expect(fileKind(suffix)).toBe(expected));
	it('拒绝空文件、超出边界一个字节及伪装扩展名', () => {
		expect(uploadError({ name: '报告.PDF', size: 10 * 1024 * 1024 })).toBe('');
		expect(uploadError({ name: '报告.pdf', size: 10 * 1024 * 1024 + 1 })).toContain('10 MB');
		expect(uploadError({ name: '报告.pdf', size: 0 })).toContain('空文件');
		expect(uploadError({ name: '报告.pdf.exe', size: 1 })).toContain('不支持');
	});
});
