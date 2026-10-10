import { describe, expect, it } from 'vitest';

import { canEditTemplateVisually, TEMPLATE_PREVIEW_CSP, templateDisplayHtml, templatePreviewDocument } from './template-display';

describe('模板安全显示副本', () => {
	it('安全 HTML/Unicode/CRLF 可视编辑，不修改原文', () => {
		const raw = '<h2 data-keep="原文">@(name)</h2>\r\n  <p>中文 &amp; 空格😀</p>\r\n';
		expect(canEditTemplateVisually(raw)).toBe(true);
		expect(templateDisplayHtml(raw)).toContain('<h2>@(name)</h2>');
		expect(raw).toBe('<h2 data-keep="原文">@(name)</h2>\r\n  <p>中文 &amp; 空格😀</p>\r\n');
	});
	it.each([
		'@{ var result = Model.name; }',
		'@if (true) {<p>x</p>}',
		'<script>parent.location="https://example.com"</script>',
		'<img src="https://example.com/probe">',
		'<p onclick="alert(1)">x</p>',
		'<svg onload="alert(1)"></svg>',
		'<html><body>x</body></html>',
	])('复杂内容通过源码保留：%s', (raw) => {
		expect(canEditTemplateVisually(raw)).toBe(false);
	});
	it('显示副本禁止脚本、导航、表单、图片及 CSS 网络资源', () => {
		const raw =
			'<meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com"><script>parent.location="https://example.com"</script><img src="https://example.com/probe"><iframe src="https://example.com"></iframe><form action="https://example.com"><input autofocus></form><a href="https://example.com" target="_top">link</a><p style="background-image:url(https://example.com/probe);color:red;text-align:center">safe</p>';
		const html = templateDisplayHtml(raw);
		expect(html).not.toMatch(/<script|<img|<meta|<base|<iframe|<form|<input|href=|src=|url\(/i);
		expect(html).toContain('safe');
		expect(html).toContain('color: red');
		expect(html).toContain('text-align: center');
		expect(raw).toContain('<script>');
	});
	it('恶意样式不进入显示副本，常规文字格式保留', () => {
		const html = templateDisplayHtml('<p style="color: expression(alert(1));font-size:16px;background-color:#fff;font-weight:bold;line-height:1.6;font-family:Arial;position:fixed">text</p>');
		expect(html).not.toMatch(/expression|position/);
		expect(html).toContain('font-weight: bold');
		expect(html).toContain('font-size: 16px');
	});
	it.each([
		'<svg><foreignObject><p onclick="alert(1)">文字</p><script>alert(1)</script></foreignObject></svg>',
		'<p style="color:red" data-title="\"><img src=https://example.com>">文字</p>',
		'<!--<img src=https://example.com>--><math><mi><style><!--</style><img src=https://example.com>',
		'&#60;img src=https://example.com onerror=alert(1)&#62;<p style="font-family:\'Arial\';color:red">实体</p>',
		'<script type="module">import("https://example.com")<p>不显示</p>',
	])('异常标记重建后没有执行或网络元素：%s', (raw) => {
		const html = templateDisplayHtml(raw);
		const document = new DOMParser().parseFromString(html, 'text/html');
		expect(document.querySelectorAll('script,style,img,iframe,svg,math,meta,base,form,a')).toHaveLength(0);
		for (const element of document.querySelectorAll('*')) {
			for (const attribute of element.attributes) expect(['style', 'colspan', 'rowspan']).toContain(attribute.name);
		}
	});
	it('iframe 文档以 CSP 禁脚本和网络资源，服务原串仍单独保留', () => {
		const raw = '<p>正常渲染</p><script>fetch("https://example.com")</script>';
		const srcdoc = templatePreviewDocument(raw);
		expect(srcdoc).toContain('http-equiv="Content-Security-Policy"');
		expect(srcdoc).toContain(TEMPLATE_PREVIEW_CSP);
		expect(srcdoc).toContain("script-src 'none'");
		expect(srcdoc).toContain("default-src 'none'");
		expect(srcdoc).not.toContain('<script>');
		expect(srcdoc).toContain('<p>正常渲染</p>');
		expect(raw).toContain('<script>');
	});
});
