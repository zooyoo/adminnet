export interface CacheNode {
	key: string;
	title: string;
	cacheKey?: string;
	selectable?: boolean;
	children?: CacheNode[];
}

export function buildCacheTree(keys: string[]): CacheNode[] {
	const result: CacheNode[] = [];
	const groups = new Map<string, CacheNode>();
	for (const key of new Set(keys)) {
		const separator = key.indexOf(':');
		if (separator < 0) {
			result.push({ key: `value:${key}`, title: key, cacheKey: key });
			continue;
		}
		const prefix = key.slice(0, separator);
		let group = groups.get(prefix);
		if (!group) {
			group = { key: `group:${prefix}`, title: prefix || ':', selectable: false, children: [] };
			groups.set(prefix, group);
			result.push(group);
		}
		group.children!.push({ key: `value:${key}`, title: key.slice(separator + 1) || ':', cacheKey: key });
	}
	return result;
}

export function displayCacheValue(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		const result: unknown = JSON.parse(value);
		return result !== null && typeof result === 'object' ? result : value;
	} catch {
		return value;
	}
}
