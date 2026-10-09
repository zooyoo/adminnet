import type { CSSProperties } from 'vue';

/** 使用浏览器 CSS 解析器保留合法声明，组件样式接口要求对象。 */
export function dictStyle(value?: null | string): CSSProperties | undefined {
	if (!value) return undefined;
	const style = document.createElement('span').style;
	style.cssText = value;
	return Object.fromEntries(Array.from(style).map((property) => [property, `${style.getPropertyValue(property)}${style.getPropertyPriority(property) ? ' !important' : ''}`]));
}
