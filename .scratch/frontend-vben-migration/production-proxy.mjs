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
	const webSockets = new Set();
	const server = createServer((incoming, outgoing) => {
		const url = new URL(incoming.url, 'http://127.0.0.1');
		if (url.pathname.startsWith('/prod-api/') || url.pathname === '/schedule' || url.pathname.startsWith('/schedule/')) {
			const upstream = request(new URL((url.pathname.startsWith('/prod-api/') ? url.pathname.slice('/prod-api'.length) : url.pathname) + url.search, apiUrl), {
				method: incoming.method, agent: false,
				headers: { ...incoming.headers, host: apiUrl.host, connection: 'close' },
			}, (response) => {
				const headers = { ...response.headers };
				if (headers.location) {
					const location = new URL(headers.location, apiUrl);
					if (location.origin === apiUrl.origin) headers.location = location.pathname + location.search;
				}
				outgoing.writeHead(response.statusCode, headers);
				response.pipe(outgoing);
			});
			upstreamRequests.add(upstream);
			upstream.on('close', () => upstreamRequests.delete(upstream));
			upstream.setTimeout(15_000, () => upstream.destroy());
			upstream.on('error', () => {
				if (!outgoing.headersSent) outgoing.writeHead(502);
				outgoing.end('Isolated API unavailable');
			});
			incoming.on('aborted', () => upstream.destroy());
			outgoing.on('close', () => {
				if (!outgoing.writableFinished) upstream.destroy();
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
	server.on('upgrade', (incoming, socket, head) => {
		const url = new URL(incoming.url, 'http://127.0.0.1');
		if (!url.pathname.startsWith('/prod-api/hubs/')) {
			socket.destroy();
			return;
		}
		const upstream = request(new URL(url.pathname.slice('/prod-api'.length) + url.search, apiUrl), {
			method: 'GET', headers: { ...incoming.headers, host: apiUrl.host },
		});
		upstreamRequests.add(upstream);
		upstream.on('close', () => upstreamRequests.delete(upstream));
		upstream.on('error', () => socket.destroy());
		upstream.on('response', (response) => {
			response.resume();
			socket.end(`HTTP/1.1 ${response.statusCode} Upgrade Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
		});
		socket.on('error', () => upstream.destroy());
		upstream.on('upgrade', (response, remote, remoteHead) => {
			webSockets.add(socket);
			webSockets.add(remote);
			let headers = '';
			for (let index = 0; index < response.rawHeaders.length; index += 2) {
				headers += `${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`;
			}
			socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`);
			if (head.length) remote.write(head);
			if (remoteHead.length) socket.write(remoteHead);
			socket.pipe(remote);
			remote.pipe(socket);
			socket.on('close', () => { webSockets.delete(socket); remote.destroy(); });
			remote.on('close', () => { webSockets.delete(remote); socket.destroy(); });
			remote.on('error', () => socket.destroy());
		});
		upstream.end();
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	return {
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		dropWebSockets() {
			for (const socket of webSockets) socket.destroy();
		},
		async close() {
			for (const socket of webSockets) socket.destroy();
			for (const upstream of upstreamRequests) upstream.destroy();
			await new Promise((resolve) => {
				server.close(resolve);
				server.closeAllConnections();
			});
		},
	};
}
