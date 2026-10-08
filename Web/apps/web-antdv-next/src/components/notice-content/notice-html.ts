import createDOMPurify from 'dompurify';

const purifier = createDOMPurify(window);
const allowedStyles = new Set([
	'background-color',
	'border-collapse',
	'color',
	'font-family',
	'font-size',
	'font-style',
	'font-weight',
	'height',
	'line-height',
	'margin-left',
	'text-align',
	'text-decoration',
	'text-indent',
	'vertical-align',
	'width',
]);

purifier.addHook('uponSanitizeAttribute', (_element, attribute) => {
	if (attribute.attrName !== 'style') return;
	const style = document.createElement('span').style;
	style.cssText = attribute.attrValue;
	const safe = document.createElement('span').style;
	for (const property of style) {
		const value = style.getPropertyValue(property);
		if (allowedStyles.has(property) && !/url\s*\(|expression\s*\(|var\s*\(|@|\\/i.test(value)) safe.setProperty(property, value);
	}
	attribute.attrValue = safe.cssText;
	attribute.keepAttr = Boolean(safe.cssText);
});

export function sanitizeNoticeHtml(html: string) {
	return purifier.sanitize(html, {
		USE_PROFILES: { html: true },
		FORBID_TAGS: ['base', 'button', 'embed', 'form', 'iframe', 'input', 'link', 'meta', 'object', 'select', 'style', 'textarea'],
		FORBID_ATTR: ['autofocus', 'class', 'contenteditable', 'id', 'name', 'srcset', 'tabindex'],
		ALLOW_ARIA_ATTR: false,
	});
}

export function noticePlainText(html: string) {
	const document = new DOMParser().parseFromString(sanitizeNoticeHtml(html), 'text/html');
	return (document.body.textContent ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

export function hasNoticeContent(html: string) {
	const clean = sanitizeNoticeHtml(html);
	return Boolean(noticePlainText(clean) || new DOMParser().parseFromString(clean, 'text/html').body.querySelector('img[src],video[src],video source[src],hr'));
}
