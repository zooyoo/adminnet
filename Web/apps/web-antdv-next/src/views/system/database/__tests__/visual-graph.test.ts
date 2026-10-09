import type { VisualDbTable } from '#/api-services/models';

import { describe, expect, it } from 'vitest';

import { buildVisualGraph, visualAnchorId } from '../visual-graph';

describe('database visual graph', () => {
	it('maps real tables, columns and relations without inventing edges', () => {
		const data: VisualDbTable = {
			visualTableList: [{ tableName: 'orders', tableComents: '订单', x: 0, y: 0 }, { tableName: 'users', tableComents: '用户', x: 420, y: 0 }],
			visualColumnList: [
				{ tableName: 'orders', columnName: 'user_id', dataType: 'bigint', dataLength: '', columnDescription: '用户' },
				{ tableName: 'users', columnName: 'id', dataType: 'bigint', dataLength: '', columnDescription: '主键' },
			],
			columnRelationList: [{ sourceTableName: 'orders', sourceColumnName: 'user_id', type: 'ONE_TO_MANY', targetTableName: 'users', targetColumnName: 'id' }],
		};
		const graph = buildVisualGraph(data, 'orders');
		expect(graph.nodes).toHaveLength(2);
		expect(graph.nodes[0]?.selected).toBe(true);
		expect(graph.nodes[0]).toEqual(expect.objectContaining({ fixed: true, width: 360, height: 132 }));
		expect(graph.elementLines).toEqual([
			expect.objectContaining({ from: visualAnchorId('orders', 'user_id'), to: visualAnchorId('users', 'id') }),
		]);
	});

	it('returns an empty graph for an empty database', () => {
		expect(buildVisualGraph({ visualTableList: [], visualColumnList: [], columnRelationList: [] })).toEqual({ nodes: [], lines: [], elementLines: [] });
	});
});
