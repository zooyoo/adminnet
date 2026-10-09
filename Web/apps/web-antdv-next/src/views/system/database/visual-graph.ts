import type { RGJsonData } from 'relation-graph/vue3';

import type { ColumnRelation, VisualDbTable, VisualTable } from '#/api-services/models';

export function visualAnchorId(tableName: string, columnName: string) {
	return `${tableName}-${columnName}`;
}

function tableColumns(data: VisualDbTable, tableName: string) {
	return (data.visualColumnList ?? []).filter((column) => column.tableName === tableName);
}

function nodeHeight(columnCount: number) {
	// relation-graph 使用节点外框尺寸参与布局；显式给出高度，避免自定义表格内容被 50px 默认节点裁切。
	return Math.max(132, 72 + Math.max(columnCount, 1) * 31);
}

export function buildVisualGraph(data: VisualDbTable, selectedTable?: string): RGJsonData {
	const tables = (data.visualTableList ?? []).filter((table): table is VisualTable & { tableName: string } => Boolean(table.tableName));
	const relations = (data.columnRelationList ?? []).filter(
		(relation): relation is ColumnRelation & { sourceTableName: string; sourceColumnName: string; targetTableName: string; targetColumnName: string } =>
			Boolean(relation.sourceTableName && relation.sourceColumnName && relation.targetTableName && relation.targetColumnName),
	);
	return {
		rootId: selectedTable || tables[0]?.tableName,
		nodes: tables.map((table, index) => ({
			id: table.tableName,
			text: table.tableComents || table.tableName,
			x: table.x ?? (index % 4) * 420,
			y: table.y ?? Math.floor(index / 4) * 300,
			width: 360,
			height: nodeHeight(tableColumns(data, table.tableName).length),
			fixed: true,
			nodeShape: 1,
			selected: table.tableName === selectedTable,
			data: { columns: tableColumns(data, table.tableName) },
		})),
		lines: [],
		elementLines: relations.map((relation) => ({
			from: visualAnchorId(relation.sourceTableName, relation.sourceColumnName),
			to: visualAnchorId(relation.targetTableName, relation.targetColumnName),
			color: relation.type === 'ONE_TO_ONE' ? 'rgba(255, 80, 80, 0.85)' : 'rgba(70, 180, 100, 0.85)',
			lineWidth: 2,
			lineShape: 6,
			fromJunctionPoint: 'right',
			toJunctionPoint: 'left',
			data: { relation },
		})),
	};
}
