const VISUAL_TAGS = [
	'p',
	'br',
	'span',
	'strong',
	'b',
	'em',
	'i',
	'u',
	's',
	'del',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'blockquote',
	'ul',
	'ol',
	'li',
	'pre',
	'code',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	'hr',
	'sub',
	'sup',
];
const tagSet = new Set(VISUAL_TAGS);

export function canEditTemplateVisually(content: string): boolean {
	const withoutParameters = content.replace(/@\((.*?)\)/g, '');
	if (withoutParameters.includes('@') || /<!doctype|<\?|\bon\w+\s*=|\b(?:src|href|srcset|formaction)\s*=|url\s*\(|expression\s*\(|@import/i.test(content)) return false;
	return [...content.matchAll(/<\/?([\w:-]+)\b/g)].every((match) => tagSet.has((match[1] ?? '').toLowerCase()));
}

function safeStyle(style: string): string {
	return style
		.split(';')
		.flatMap((entry) => {
			const colon = entry.indexOf(':');
			const property = entry.slice(0, colon).trim().toLowerCase();
			const value = entry.slice(colon + 1).trim();
			let valid = false;
			if (['background-color', 'border-color', 'color'].includes(property)) valid = /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(value);
			else if (['border-width', 'font-size', 'height', 'line-height', 'max-width', 'text-indent', 'width'].includes(property)) valid = /^(?:\d+(?:\.\d+)?(?:px|em|rem|%|pt)?|normal)$/i.test(value);
			else if (property === 'font-weight') valid = /^(?:normal|bold|[1-9]00)$/i.test(value);
			else if (property === 'font-style') valid = /^(?:normal|italic|oblique)$/i.test(value);
			else if (property === 'text-align') valid = /^(?:left|right|center|justify)$/i.test(value);
			else if (property === 'text-decoration') valid = /^(?:none|underline|line-through)$/i.test(value);
			else if (property === 'font-family') valid = /^[\p{L}\p{N} ,'-]+$/u.test(value);
			else if (property === 'border-style') valid = /^(?:none|solid|dashed|dotted|double)$/i.test(value);
			return colon > 0 && valid ? [property + ': ' + value] : [];
		})
		.join('; ');
}

function escapeText(value: string): string {
	// 字符引用在 HTML 文本位置不会再次作为标签解析，保留原有实体的显示含义。
	return value.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function escapeAttribute(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function displayAttributes(attributes: string): string {
	const result: string[] = [];
	for (const match of attributes.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/g)) {
		const name = (match[1] ?? '').toLowerCase();
		const value = match[2] ?? match[3] ?? match[4] ?? '';
		if (name === 'style') {
			const style = safeStyle(value);
			if (style) result.push('style="' + escapeAttribute(style) + '"');
		} else if (['colspan', 'rowspan'].includes(name) && /^\d{1,3}$/.test(value) && Number(value) > 0) result.push(name + '="' + value + '"');
	}
	return result.length ? ' ' + result.join(' ') : '';
}

// 原串不进入 DOM 解析器：重建有限文字标签和属性，原始 Content/渲染字符串单独保留。
export function templateDisplayHtml(content: string): string {
	let cursor = 0;
	let result = '';
	let rawTextTag = '';
	for (const match of content.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)(\s[^<>]*?)?\/?>/gi)) {
		const token = match[0];
		const tag = (match[1] ?? '').toLowerCase();
		const closing = token.startsWith('</');
		const index = match.index ?? cursor;
		if (!rawTextTag) result += escapeText(content.slice(cursor, index));
		cursor = index + token.length;
		if (rawTextTag) {
			if (closing && tag === rawTextTag) rawTextTag = '';
			continue;
		}
		if (!closing && ['script', 'style'].includes(tag)) {
			rawTextTag = tag;
			continue;
		}
		if (!tagSet.has(tag)) continue;
		result += closing ? '</' + tag + '>' : '<' + tag + displayAttributes(match[2] ?? '') + '>';
	}
	return rawTextTag ? result : result + escapeText(content.slice(cursor));
}

export const TEMPLATE_PREVIEW_CSP =
	"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function templatePreviewDocument(content: string): string {
	return (
		'<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="' +
		TEMPLATE_PREVIEW_CSP +
		'"><style>body{font:14px/1.65 system-ui,sans-serif;margin:16px;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:6px}pre{white-space:pre-wrap}</style></head><body>' +
		templateDisplayHtml(content) +
		'</body></html>'
	);
}
