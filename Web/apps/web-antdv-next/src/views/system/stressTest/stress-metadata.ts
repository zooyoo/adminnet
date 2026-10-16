import type { StressTestPair } from '#/api/system/stress-test';

import { requestClient } from '#/api/request';
export interface MetadataGroup {
	name: string;
	url: string;
}
export interface MetadataOperation {
	key: string;
	path: string;
	method: string;
	summary: string;
	tag: string;
	tagTitle: string;
	headers: StressTestPair[];
	requestParameters: StressTestPair[];
	pathParameters: StressTestPair[];
	queryParameters: StressTestPair[];
}
type Json = Record<string, unknown>;
const object = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {});
const cleanTitle = (value: unknown, fallback: string) => (typeof value === 'string' ? value.replace(/\p{Extended_Pictographic}/gu, '').trim() || fallback : fallback);
function resolve(value: unknown, document: Json): Json {
	const item = object(value);
	const ref = item.$ref;
	if (typeof ref !== 'string' || !ref.startsWith('#/')) return item;
	return object(
		ref
			.slice(2)
			.split('/')
			.reduce<unknown>((current, key) => object(current)[key.replace(/~1/g, '/').replace(/~0/g, '~')], document)
	);
}
function pairs(value: unknown, document: Json): StressTestPair[] {
	const schema = resolve(value, document);
	return Object.entries(object(schema.properties)).map(([key, property]) => ({ key, value: emptyValue(resolve(property, document)) }));
}
function emptyValue(schema: Json): string {
	return schema.type === 'number' || schema.type === 'integer' ? '0' : schema.type === 'boolean' ? 'false' : schema.type === 'object' ? '{}' : schema.type === 'array' ? '[]' : '';
}
export async function getMetadataGroups(signal: AbortSignal): Promise<MetadataGroup[]> {
	const value = await requestClient.get<unknown>('/api/swagger/swaggerGroups', { signal });
	if (!Array.isArray(value)) throw new Error('Swagger 分组响应无效');
	return value
		.map((entry) => object(entry))
		.filter((entry) => typeof entry.name === 'string' && typeof entry.url === 'string' && !/all(?:%20| )groups/i.test(entry.url))
		.map((entry) => {
			const raw = String(entry.url).replace(/^\/+/, '/');
			if (!/^\/swagger\/[^/?#]+\/swagger\.json$/u.test(raw)) throw new Error('Swagger 地址须位于当前服务');
			let name = String(entry.name);
			try {
				name = decodeURIComponent(name);
			} catch {}
			return { name, url: raw };
		});
}
export async function getMetadataDocument(url: string, signal: AbortSignal): Promise<Json> {
	if (!/^\/swagger\/[^/?#]+\/swagger\.json$/u.test(url)) throw new Error('Swagger 地址无效');
	const document = object(await requestClient.get<unknown>(url, { signal }));
	if (!document.paths || typeof document.paths !== 'object') throw new Error('Swagger 接口文档无效');
	return document;
}
export function metadataOperations(document: Json | undefined): MetadataOperation[] {
	if (!document) return [];
	const tags = new Map(
		(Array.isArray(document.tags) ? document.tags : []).map((tag) => {
			const row = object(tag);
			return [String(row.name ?? ''), cleanTitle(row.description, String(row.name ?? '未分组'))];
		})
	);
	const rows: MetadataOperation[] = [];
	for (const [path, value] of Object.entries(object(document.paths))) {
		const pathItem = object(value);
		for (const [method, input] of Object.entries(pathItem)) {
			if (!['delete', 'get', 'head', 'options', 'patch', 'post', 'put'].includes(method)) continue;
			const op = object(input);
			const tag = String(Array.isArray(op.tags) ? (op.tags[0] ?? '未分组') : '未分组');
			const row: MetadataOperation = {
				key: method + ':' + path,
				path,
				method: method.toUpperCase(),
				summary: cleanTitle(op.summary, path),
				tag,
				tagTitle: tags.get(tag) ?? tag,
				headers: [],
				requestParameters: [],
				pathParameters: [],
				queryParameters: [],
			};
			for (const raw of [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
				const parameter = resolve(raw, document);
				if (parameter.in === 'body') {
					row.requestParameters = pairs(parameter.schema, document);
					continue;
				}
				const key = typeof parameter.name === 'string' ? parameter.name : '';
				if (!key) continue;
				const pair = { key, value: emptyValue(resolve(parameter.schema ?? parameter, document)) };
				if (parameter.in === 'header') row.headers.push(pair);
				else if (parameter.in === 'path') row.pathParameters.push(pair);
				else if (parameter.in === 'query') row.queryParameters.push(pair);
			}
			const body = resolve(op.requestBody, document);
			const content = object(body.content);
			const media = object(content['application/x-www-form-urlencoded'] ?? content['application/json'] ?? Object.values(content)[0]);
			if (media.schema) row.requestParameters = pairs(media.schema, document);
			rows.push(row);
		}
	}
	return rows;
}
