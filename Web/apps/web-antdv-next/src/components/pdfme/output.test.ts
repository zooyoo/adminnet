import { afterEach, describe, expect, it, vi } from 'vitest';

import { parsePrintParameters, sendToPrintService } from './output';
import { createDefaultTemplate } from './template';

vi.mock('@pdfme/generator', () => ({ generate: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) }));
vi.mock('./template', async (original) => ({ ...(await original<typeof import('./template')>()), loadPdfmeOptions: async () => ({}) }));
afterEach(() => vi.unstubAllGlobals());

describe('print service acknowledgement', () => {
	const template = createDefaultTemplate();
	const inputs = [{ name: '中文' }];
	const address = 'http://127.0.0.1:12345/print';
	it.each([new Response('', { status: 202 }), Response.json({}), Response.json({ accepted: false }), Response.json({ accepted: 'true' }), new Response('', { status: 503 })])(
		'does not treat HTTP success as job acceptance',
		async (response) => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => response)
			);
			await expect(sendToPrintService(template, inputs, { clientServiceAddress: address })).rejects.toThrow('打印服务');
		}
	);
	it('sends encoded title and copies without ambient credentials', async () => {
		const fetcher = vi.fn(async () => Response.json({ accepted: true }, { status: 202 }));
		vi.stubGlobal('fetch', fetcher);
		await sendToPrintService(template, inputs, { clientServiceAddress: address, copies: 2, title: '中文任务' });
		expect(fetcher).toHaveBeenCalledWith(
			new URL(address),
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'error',
				method: 'POST',
				headers: { 'X-Pdfme-Copies': '2', 'X-Pdfme-Title': encodeURIComponent('中文任务') },
			})
		);
	});
	it.each([0, -1, 1.5, 101, Number.NaN])('rejects invalid copies before sending: %s', async (copies) => {
		const fetcher = vi.fn();
		vi.stubGlobal('fetch', fetcher);
		await expect(sendToPrintService(template, inputs, { clientServiceAddress: address, copies })).rejects.toThrow('份数');
		expect(fetcher).not.toHaveBeenCalled();
	});
	it('rejects credentials in service URLs', async () => {
		await expect(sendToPrintService(template, inputs, { clientServiceAddress: 'http://user:password@localhost/print' })).rejects.toThrow('凭据');
	});
	it('cancels before generation and transport', async () => {
		const controller = new AbortController();
		controller.abort();
		const fetcher = vi.fn();
		vi.stubGlobal('fetch', fetcher);
		await expect(sendToPrintService(template, inputs, { clientServiceAddress: address, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
		expect(fetcher).not.toHaveBeenCalled();
	});
	it.each(['null', '[]', '{', '{"copies":0}', '{"copies":1.5}', '{"copies":"2"}', '{"title":3}'])('rejects damaged saved parameters: %s', (value) => {
		expect(() => parsePrintParameters(value)).toThrow('打印参数');
	});
	it('normalizes supported parameters without forwarding unknown fields', () => {
		expect(parsePrintParameters('{"copies":2,"title":"中文","credentials":"include"}')).toEqual({ copies: 2, title: '中文' });
	});
});
