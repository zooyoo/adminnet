<script setup lang="ts">
import type { NotificationItem } from '@vben/layouts';

import { ref } from 'vue';

import { Bell, MailCheck, RotateCw } from '@vben/icons';

import { Alert, Badge, Button, Empty, Popover, Spin, Tooltip } from 'antdv-next';

defineProps<{ items: NotificationItem[]; error: string; loading: boolean; reading: boolean }>();
const emit = defineEmits<{ refresh: []; readAll: []; viewAll: []; detail: [item: NotificationItem] }>();
const open = ref(false);
function viewAll() {
	open.value = false;
	emit('viewAll');
}
function detail(item: NotificationItem) {
	open.value = false;
	emit('detail', item);
}
</script>

<template>
	<Popover v-model:open="open" trigger="click" placement="bottom" :auto-adjust-overflow="true">
		<Badge :count="items.length" :overflow-count="99">
			<Button type="text" class="bell-button" :aria-label="`通知，${items.length} 条未读`"><Bell :size="18" /></Button>
		</Badge>
		<template #content>
			<section class="notice-inbox" aria-label="未读通知">
				<header>
					<strong>未读通知（{{ items.length }}）</strong>
					<div class="notice-actions">
						<Tooltip title="刷新通知"
							><Button type="text" aria-label="刷新通知" :loading="loading" @click="emit('refresh')"><RotateCw :size="16" /></Button
						></Tooltip>
						<Tooltip title="全部标记为已读"
							><Button type="text" aria-label="全部标记为已读" :loading="reading" :disabled="items.length === 0 || loading" @click="emit('readAll')"><MailCheck :size="16" /></Button
						></Tooltip>
					</div>
				</header>
				<Alert v-if="error" :message="error" type="error" show-icon />
				<Spin :spinning="loading">
					<ul v-if="items.length" class="notice-list">
						<li v-for="item in items" :key="item.id">
							<button type="button" class="notice-item" @click="detail(item)">
								<strong>{{ item.title }}</strong>
								<span>{{ item.message }}</span>
								<time>{{ item.date }}</time>
							</button>
						</li>
					</ul>
					<Empty v-else-if="!loading && !error" description="没有未读通知" />
				</Spin>
				<footer><Button type="link" @click="viewAll">查看所有消息</Button></footer>
			</section>
		</template>
	</Popover>
</template>

<style scoped>
.notice-inbox {
	width: min(320px, calc(100vw - 72px));
}
header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding-bottom: 8px;
}
.notice-actions {
	display: flex;
	flex-shrink: 0;
}
.notice-list {
	max-height: min(420px, 55dvh);
	overflow: auto;
}
.notice-item {
	display: flex;
	flex-direction: column;
	gap: 6px;
	width: 100%;
	padding: 12px 4px;
	text-align: left;
	overflow-wrap: anywhere;
	border-bottom: 1px solid var(--ant-color-border-secondary);
}
.notice-item:hover {
	background: var(--ant-color-fill-secondary);
}
.notice-item:focus-visible {
	outline: 2px solid var(--ant-color-primary);
	outline-offset: -2px;
}
.notice-item span {
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	color: var(--ant-color-text-secondary);
}
.notice-item time {
	font-size: 12px;
	color: var(--ant-color-text-tertiary);
}
footer {
	display: flex;
	justify-content: flex-end;
	border-top: 1px solid var(--ant-color-border-secondary);
	padding-top: 8px;
}
</style>
