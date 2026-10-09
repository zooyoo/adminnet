import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

// 所有代表文件由本地代码生成，不下载外部业务资料。
function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
	const locals = [], central = [];
	let offset = 0;
	for (const [path, text] of Object.entries(entries)) {
		const name = Buffer.from(path), bytes = Buffer.from(text);
		const local = Buffer.alloc(30), directory = Buffer.alloc(46);
		local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
		local.writeUInt32LE(crc32(bytes), 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
		directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
		directory.writeUInt32LE(crc32(bytes), 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
		locals.push(local, name, bytes); central.push(directory, name); offset += local.length + name.length + bytes.length;
	}
	const index = Buffer.concat(central), end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, index, end]);
}
function pdf() {
	const text = 'BT /F1 24 Tf 60 760 Td (Admin.NET local PDF preview) Tj ET';
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		`<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
	];
	let output = '%PDF-1.4\n';
	const offsets = [0];
	objects.forEach((value, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${value}\nendobj\n`; });
	const start = Buffer.byteLength(output);
	output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
	return Buffer.from(output);
}
function wav() {
	const samples = 8000, buffer = Buffer.alloc(44 + samples * 2);
	buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28);
	buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 8000) * 1000), 44 + i * 2);
	return buffer;
}
function png() {
	const width = 640, height = 360, pixels = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const offset = y * (width * 3 + 1) + 1 + x * 3;
		pixels[offset] = 22 + Math.round(x / width * 80);
		pixels[offset + 1] = 80 + Math.round(y / height * 120);
		pixels[offset + 2] = x > 240 && x < 400 && y > 100 && y < 260 ? 100 : 240;
	}
	function chunk(type, bytes) {
		const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
		size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
		return Buffer.concat([size, name, bytes, crc]);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export function localFileFixtures(packagePath) {
	const XLSX = createRequire(packagePath)('xlsx-js-style');
	const book = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['本地工作簿', '数量'], ['测试文件', 17], ['预览验证', 18]]), '文件验收');
	return [
		{ name: '图片.png', type: 'image/png', bytes: png() },
		{ name: '文档.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: zip({
			'[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
			'_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
			'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>本地文件预览验收</w:t></w:r></w:p><w:p><w:r><w:t>Admin.NET DOCX 17 18</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
		}) },
		{ name: '工作簿.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) },
		{ name: '阅读.pdf', type: 'application/pdf', bytes: pdf() },
		{ name: '音频.wav', type: 'audio/wav', bytes: wav() },
		{ name: '说明.txt', type: 'text/plain', bytes: Buffer.from('本地不支持预览的文本') },
		{ name: '损坏.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: Buffer.from('corrupt local office fixture') },
	];
}
export async function localVideo(page) {
	const base64 = await page.evaluate(async () => {
		const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
		const context = canvas.getContext('2d');
		const stream = canvas.captureStream(10);
		const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
		const chunks = [];
		const finished = new Promise((resolve, reject) => {
			recorder.ondataavailable = (event) => chunks.push(event.data);
			recorder.onerror = reject; recorder.onstop = resolve;
		});
		recorder.start();
		for (let frame = 0; frame < 8; frame++) {
			context.fillStyle = frame % 2 ? '#1677ff' : '#0958d9'; context.fillRect(0, 0, 320, 180);
			context.fillStyle = '#fff'; context.font = '22px sans-serif'; context.fillText('Admin.NET local video', 20, 90);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		recorder.stop(); await finished; stream.getTracks().forEach((track) => track.stop());
		const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
		return btoa(String.fromCharCode(...bytes));
	});
	return { name: '视频.webm', type: 'video/webm', bytes: Buffer.from(base64, 'base64') };
}
