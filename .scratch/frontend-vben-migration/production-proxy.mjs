import assert from 'node:assert/strict';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, sep } from 'node:path';

// 仅服务已有生产产物，并将 API 原样代理到隔离后端。
export async function startProductionProxy(distRoot, apiUrl) {
	assert.equal(apiUrl.protocol, 'http:');
	assert.equal(apiUrl.hostname, '127.0.0.1');
	const root = realpathSync(distRoot);
	const mimeTypes = {
		'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
		'.css': 'text/css; charset=utf-8', '.json': 'application/json',
		'.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
	};
	const upstreamRequests = new Set();
	const server = createServer((incoming, outgoing) => {
		const url = new URL(incoming.url, 'http://127.0.0.1');
		if (url.pathname.startsWith('/prod-api/')) {
			const upstream = request(new URL(url.pathname.slice('/prod-api'.length) + url.search, apiUrl), {
				method: incoming.method, agent: false,
				headers: { ...incoming.headers, host: apiUrl.host, connection: 'close' },
			}, (response) => {
				outgoing.writeHead(response.statusCode, response.headers);
				response.pipe(outgoing);
			});
			upstreamRequests.add(upstream);
			upstream.on('close', () => upstreamRequests.delete(upstream));
			upstream.setTimeout(15_000, () => upstream.destroy());
			upstream.on('error', () => {
				if (!outgoing.headersSent) outgoing.writeHead(502);
				outgoing.end('Isolated API unavailable');
			});
			incoming.pipe(upstream);
			return;
		}
		try {
			const target = realpathSync(join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
			if (!target.startsWith(root + sep) || !statSync(target).isFile()) {
				outgoing.writeHead(404).end();
				return;
			}
			outgoing.writeHead(200, { 'content-type': mimeTypes[extname(target)] ?? 'application/octet-stream' });
			createReadStream(target).pipe(outgoing);
		} catch {
			outgoing.writeHead(404).end();
		}
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	return {
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		async close() {
			for (const upstream of upstreamRequests) upstream.destroy();
			await new Promise((resolve) => {
				server.close(resolve);
				server.closeAllConnections();
			});
		},
	};
}
