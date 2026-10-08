<script setup lang="ts">
import { computed } from 'vue';

import { sanitizeNoticeHtml } from './notice-html';

const props = defineProps<{ content: string }>();
const safeHtml = computed(() => sanitizeNoticeHtml(props.content));
</script>

<template>
	<div class="notice-rich-content" v-html="safeHtml"></div>
</template>

<style scoped>
.notice-rich-content {
	min-width: 0;
	overflow: auto;
	overflow-wrap: anywhere;
	line-height: 1.65;
}
.notice-rich-content :deep(img),
.notice-rich-content :deep(video) {
	max-width: 100%;
	height: auto;
}
.notice-rich-content :deep(p) {
	margin: 0.5em 0;
}
.notice-rich-content :deep(ul) {
	list-style: disc;
	padding-left: 1.5em;
}
.notice-rich-content :deep(ol) {
	list-style: decimal;
	padding-left: 1.5em;
}
.notice-rich-content :deep(table) {
	border-collapse: collapse;
	max-width: 100%;
}
.notice-rich-content :deep(th),
.notice-rich-content :deep(td) {
	border: 1px solid var(--ant-color-border);
	padding: 6px 10px;
}
.notice-rich-content :deep(blockquote) {
	border-left: 3px solid var(--ant-color-border);
	margin: 8px 0;
	padding-left: 12px;
}
.notice-rich-content :deep(a) {
	color: var(--ant-color-primary);
	text-decoration: underline;
}
.notice-rich-content :deep(pre) {
	white-space: pre-wrap;
}
.notice-rich-content :deep(h1) {
	font-size: 24px;
}
.notice-rich-content :deep(h2) {
	font-size: 20px;
}
.notice-rich-content :deep(h3) {
	font-size: 18px;
}
</style>
