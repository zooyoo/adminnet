export interface AdminTreeNode {
	id?: number;
	name?: null | string;
	title?: null | string;
	tenantId?: null | number;
	disabled?: boolean;
	children?: AdminTreeNode[] | null;
}

export interface TreeOption {
	key: number;
	value: number;
	title: string;
	disabled: boolean;
	children?: TreeOption[];
}

export function treeOptions(nodes: AdminTreeNode[], excludedId?: number, tenantId?: number): TreeOption[] {
	return nodes.flatMap((node) => {
		if (node.id === undefined || node.id === excludedId) return [];
		if (tenantId && node.tenantId && node.tenantId !== tenantId) return [];
		const children = treeOptions(node.children ?? [], excludedId, tenantId);
		return [
			{
				key: node.id,
				value: node.id,
				title: node.title ?? node.name ?? String(node.id),
				disabled: Boolean(node.disabled),
				...(children.length ? { children } : {}),
			},
		];
	});
}

export function treeKeys(nodes: TreeOption[]): number[] {
	return nodes.flatMap((node) => [node.key, ...treeKeys(node.children ?? [])]);
}

export function findTreeNode<T extends AdminTreeNode>(nodes: T[], id: number): T | undefined {
	for (const node of nodes) {
		if (node.id === id) return node;
		const found = findTreeNode((node.children ?? []) as T[], id);
		if (found) return found;
	}
}

export function normalizeTableTree<T extends { children?: null | T[] }>(nodes: T[]): T[] {
	return nodes.map((node) => ({ ...node, children: node.children?.length ? normalizeTableTree(node.children) : undefined }));
}

export function normalizeMenuIcon(icon?: null | string): string {
	if (!icon) return '';
	if (icon.startsWith('ele-')) {
		return `ep:${icon
			.slice(4)
			.replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
			.replaceAll(/([a-z\d])([A-Z])/g, '$1-$2')
			.toLowerCase()}`;
	}
	const fontAwesome = /(?:^|\s)fa-([a-z\d-]+)/.exec(icon);
	return fontAwesome ? `fa:${fontAwesome[1]}` : icon;
}
