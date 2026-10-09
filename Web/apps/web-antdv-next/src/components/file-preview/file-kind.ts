export function fileKind(suffix: null | string | undefined) {
	switch (suffix?.toLowerCase()) {
		case '.jpg':
		case '.jpeg':
		case '.png':
		case '.gif':
		case '.bmp':
		case '.webp':
			return 'image';
		case '.docx':
			return 'docx';
		case '.xlsx':
		case '.xls':
			return 'excel';
		case '.pdf':
			return 'pdf';
		case '.mp4':
		case '.webm':
		case '.ogg':
			return 'video';
		case '.mp3':
		case '.wav':
		case '.m4a':
			return 'audio';
		default:
			return 'unsupported';
	}
}

export function uploadError(file: Pick<File, 'name' | 'size'>) {
	if (file.size <= 0) return '不能上传空文件';
	if (file.size > 10 * 1024 * 1024) return '文件大小不能超过 10 MB';
	if (!/\.(?:jpg|jpeg|png|bmp|gif|webp|txt|xml|pdf|xlsx|xls|docx|mp4|webm|ogg|mp3|wav|m4a)$/i.test(file.name)) return '不支持上传此文件类型';
	return '';
}
