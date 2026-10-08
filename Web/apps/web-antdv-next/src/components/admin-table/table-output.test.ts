import { describe, expect, it } from 'vitest';
import { utils } from 'xlsx-js-style';

import { printableTable, tableMatrix } from './table-output';

describe('table output', () => {
	it('exports only configured data columns in display order and formats without mutating rows', () => {
		const input = [{ name: 'Example', sysFlag: 1, internal: 'not exported', profile: { label: 'Nested' } }];
		const matrix = tableMatrix(
			input,
			[
				{ key: 'profile', title: 'Group', children: [{ title: 'Label', dataIndex: ['profile', 'label'] }] },
				{ title: '内置', key: 'sysFlag', dataIndex: 'sysFlag' },
				{ title: '名称', key: 'name', dataIndex: 'name' },
				{ title: '操作', key: 'actions' },
			],
			{ sysFlag: (row) => (row.sysFlag === 1 ? '是' : '否') }
		);
		expect(matrix).toEqual([
			['Group / Label', '内置', '名称'],
			['Nested', '是', 'Example'],
		]);
		expect(input[0]?.sysFlag).toBe(1);
	});
	it('treats formula-like user data as spreadsheet text and preserves numeric values', () => {
		const sheet = utils.aoa_to_sheet(
			tableMatrix(
				[{ value: '=HYPERLINK("https://example.invalid")', amount: 10 }],
				[
					{ dataIndex: 'value', title: '值' },
					{ dataIndex: 'amount', title: '数量' },
				]
			)
		);
		expect(sheet.A2.t).toBe('s');
		expect(sheet.A2.f).toBeUndefined();
		expect(sheet.B2).toMatchObject({ t: 'n', v: 10 });
	});
	it('prints user content as text, never active HTML', () => {
		const html = printableTable([['Name'], ['<img src=x onerror=alert(1)>']], '<script>alert(1)</script>');
		const node = document.createElement('div');
		node.innerHTML = html;
		expect(node.querySelector('script,img')).toBeNull();
		expect(node.querySelector('td')?.textContent).toBe('<img src=x onerror=alert(1)>');
		expect(node.querySelectorAll('thead th')).toHaveLength(1);
	});
});
