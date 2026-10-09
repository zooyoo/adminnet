import type { Template } from '@pdfme/common';

import { generate } from '@pdfme/generator';

import { loadPdfmeOptions, pdfmePlugins } from './template';

export interface PrintServiceOptions {
	clientServiceAddress?: null | string;
	copies?: number;
	title?: string;
	signal?: AbortSignal;
}

export function parsePrintParameters(value?: null | string): Pick<PrintServiceOptions, 'copies' | 'title'> {
	try {
		const result: unknown = JSON.parse(value || '{}');
		if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid');
		const { copies = 1, title = '' } = result as Record<string, unknown>;
		if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 100 || typeof title !== 'string' || title.length > 200) throw new Error('invalid');
		return { copies, title };
	} catch {
		throw new Error('打印参数须为 JSON 对象，份数为 1 到 100 的整数，标题不超过 200 字');
	}
}

export async function generatePdf(template: Template, inputs: Array<Record<string, string>>) {
	return generate({ inputs, options: await loadPdfmeOptions(), plugins: pdfmePlugins, template });
}

export async function previewPdf(template: Template, inputs: Array<Record<string, string>>, isCurrent = () => true) {
	const preview = window.open('about:blank', '_blank');
	if (!preview) throw new Error('PDF 预览窗口被拦截，请允许弹出窗口后重试');
	preview.opener = null;
	try {
		const pdf = await generatePdf(template, inputs);
		if (!isCurrent()) {
			preview.close();
			return;
		}
		const url = URL.createObjectURL(new Blob([pdf.buffer], { type: 'application/pdf' }));
		preview.location.replace(url);
		window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
	} catch (error) {
		preview.close();
		throw error;
	}
}

export async function printPdf(template: Template, inputs: Array<Record<string, string>>, isCurrent = () => true) {
	const pdf = await generatePdf(template, inputs);
	if (!isCurrent()) return;
	const url = URL.createObjectURL(new Blob([pdf.buffer], { type: 'application/pdf' }));
	const frame = document.createElement('iframe');
	frame.title = 'PDF 打印';
	frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;border:0';
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			frame.remove();
			URL.revokeObjectURL(url);
		};
		const timer = window.setTimeout(() => {
			cleanup();
			reject(new Error('PDF 打印加载超时'));
		}, 30_000);
		frame.onload = () => {
			window.clearTimeout(timer);
			if (!isCurrent()) {
				cleanup();
				resolve();
				return;
			}
			try {
				if (!frame.contentWindow) throw new Error('PDF 打印窗口不可用');
				frame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
				frame.contentWindow.focus();
				frame.contentWindow.print();
				window.setTimeout(cleanup, 120_000);
				resolve();
			} catch (error) {
				cleanup();
				reject(error);
			}
		};
		frame.src = url;
		document.body.append(frame);
	});
}

export async function downloadPdf(template: Template, inputs: Array<Record<string, string>>, name: string, isCurrent = () => true) {
	const pdf = await generatePdf(template, inputs);
	if (!isCurrent()) return;
	const url = URL.createObjectURL(new Blob([pdf.buffer], { type: 'application/pdf' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = `${name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')}.pdf`;
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function sendToPrintService(template: Template, inputs: Array<Record<string, string>>, options: PrintServiceOptions) {
	options.signal?.throwIfAborted();
	if (!options.clientServiceAddress) throw new Error('请配置客户端服务地址');
	const serviceUrl = new URL(options.clientServiceAddress);
	if (!['http:', 'https:'].includes(serviceUrl.protocol)) throw new Error('客户端服务地址必须使用 HTTP 或 HTTPS');
	if (serviceUrl.username || serviceUrl.password) throw new Error('客户端服务地址不能包含凭据');
	const copies = options.copies ?? 1;
	if (!Number.isInteger(copies) || copies < 1 || copies > 100) throw new Error('打印份数必须是 1 到 100 的整数');
	const pdf = await generatePdf(template, inputs);
	options.signal?.throwIfAborted();
	let response: Response;
	try {
		response = await fetch(serviceUrl, {
			body: new Blob([pdf.buffer], { type: 'application/pdf' }),
			headers: {
				'X-Pdfme-Copies': String(copies),
				'X-Pdfme-Title': encodeURIComponent(options.title ?? 'Admin.NET 打印任务'),
			},
			method: 'POST',
			credentials: 'omit',
			redirect: 'error',
			signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
		});
	} catch {
		options.signal?.throwIfAborted();
		throw new Error('打印服务不可用');
	}
	if (!response.ok) throw new Error(`打印服务不可用（HTTP ${response.status}）`);
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('application/json')) throw new Error('打印服务未返回有效回执');
	const result: unknown = await response.json();
	if (!result || typeof result !== 'object' || !('accepted' in result) || result.accepted !== true) throw new Error('打印服务未确认接收任务');
}
