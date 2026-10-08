import type { AxiosResponse } from 'axios';

export interface FileResponse {
	blob: Blob;
	fileName: string;
}
export type DecodedFile = { kind: 'file'; file: FileResponse } | { kind: 'success'; message: string };

export function responseFileName(disposition: string, fallback: string): string {
	const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1];
	const plain = /filename\s*=\s*"([^"]+)"/i.exec(disposition)?.[1] ?? /filename\s*=\s*([^;]+)/i.exec(disposition)?.[1];
	let name = encoded ?? plain ?? fallback;
	try {
		name = decodeURIComponent(name.trim());
	} catch {
		name = fallback;
	}
	return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/^\.+/, '_') || fallback;
}

export async function decodeFileResponse(response: AxiosResponse<ArrayBuffer | Blob>, fallback: string): Promise<DecodedFile> {
	const contentType = String(response.headers['content-type'] ?? (response.data instanceof Blob ? response.data.type : ''));
	const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: contentType || 'application/octet-stream' });
	if (/json/i.test(contentType)) {
		const result: { code?: number; message?: unknown; errors?: unknown } = JSON.parse(await blob.text());
		const value = result.errors ?? result.message;
		const text = typeof value === 'string' ? value : value ? JSON.stringify(value) : '';
		if (result.code !== 200 || result.errors) throw new Error(text || '文件操作失败');
		return { kind: 'success', message: text || '操作成功' };
	}
	return { kind: 'file', file: { blob, fileName: responseFileName(String(response.headers['content-disposition'] ?? ''), fallback) } };
}

export function downloadFile(file: FileResponse) {
	const url = URL.createObjectURL(file.blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = file.fileName;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
