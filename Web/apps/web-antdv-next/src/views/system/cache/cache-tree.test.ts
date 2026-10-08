import { describe, expect, it } from 'vitest';

import { buildCacheTree, displayCacheValue } from './cache-tree';

describe('cache namespace tree', () => {
	it('keeps namespace and standalone keys distinct without collisions', () => {
		const tree = buildCacheTree(['user', 'user:1', 'user:2:profile', 'other:1', 'user:1']);
		expect(tree[0]).toEqual({ key: 'value:user', title: 'user', cacheKey: 'user' });
		expect(tree[1]).toMatchObject({
			key: 'group:user',
			selectable: false,
			children: [
				{ key: 'value:user:1', cacheKey: 'user:1', title: '1' },
				{ key: 'value:user:2:profile', cacheKey: 'user:2:profile', title: '2:profile' },
			],
		});
		const allKeys = tree.flatMap((node) => [node.key, ...(node.children ?? []).map((child) => child.key)]);
		expect(new Set(allKeys).size).toBe(allKeys.length);
	});
	it('preserves punctuation and names that resemble JavaScript prototype keys', () => {
		const tree = buildCacheTree(['__proto__:中文/%?key', ':', 'plain']);
		expect(tree[0]?.children?.[0]?.cacheKey).toBe('__proto__:中文/%?key');
		expect(tree[1]?.children?.[0]?.cacheKey).toBe(':');
	});
	it('parses structured JSON while preserving ordinary strings and primitives', () => {
		expect(displayCacheValue('{"count":2}')).toEqual({ count: 2 });
		expect(displayCacheValue('[1,2]')).toEqual([1, 2]);
		expect(displayCacheValue('123')).toBe('123');
		expect(displayCacheValue('null')).toBe('null');
		expect(displayCacheValue('not json')).toBe('not json');
		expect(displayCacheValue(false)).toBe(false);
	});
});
