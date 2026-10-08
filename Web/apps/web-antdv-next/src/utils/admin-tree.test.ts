import { describe, expect, it } from 'vitest';

import { findTreeNode, normalizeMenuIcon, normalizeTableTree, treeKeys, treeOptions } from './admin-tree';

describe('admin tree contracts', () => {
	const nodes = [
		{ id: 1, name: 'Parent', tenantId: 10, children: [{ id: 2, name: 'Child', tenantId: 10, disabled: true }] },
		{ id: 3, name: 'Other tenant', tenantId: 20 },
	];

	it('excludes the edited node and all descendants from parent choices', () => {
		expect(treeKeys(treeOptions(nodes, 1))).toEqual([3]);
		expect(treeKeys(treeOptions(nodes, 2))).toEqual([1, 3]);
	});

	it('preserves disabled state and does not expose another tenant', () => {
		const result = treeOptions(nodes, undefined, 10);
		expect(treeKeys(result)).toEqual([1, 2]);
		expect(result[0]?.children?.[0]?.disabled).toBe(true);
		expect(nodes[0]?.children?.[0]?.name).toBe('Child');
	});

	it('finds nested records and normalizes leaf children without mutation', () => {
		expect(findTreeNode(nodes, 2)?.name).toBe('Child');
		expect(findTreeNode(nodes, 999)).toBeUndefined();
		const input = [{ id: 1, children: [] }];
		expect(normalizeTableTree(input)[0]?.children).toBeUndefined();
		expect(input[0]?.children).toEqual([]);
	});

	it.each([
		['ele-Setting', 'ep:setting'],
		['ele-DArrowRight', 'ep:d-arrow-right'],
		['ele-OfficeBuilding', 'ep:office-building'],
		['fa fa-user', 'fa:user'],
		['lucide:users', 'lucide:users'],
		['/assets/logo.png', '/assets/logo.png'],
	])('maps legacy icon %s without importing Element Plus', (input, expected) => {
		expect(normalizeMenuIcon(input)).toBe(expected);
	});
});
