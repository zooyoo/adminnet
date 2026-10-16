<script setup lang="ts">
import type { WidgetKey, WorkbenchLayout } from './workbench';

import type { MenuOutput } from '#/api-services/models';
import type { AdminUserInfo } from '#/api/core/user';

import { computed, onMounted, onScopeDispose, ref } from 'vue';
import { useRouter } from 'vue-router';

import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Card, CheckboxGroup, Modal, Select } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { getAvailableMenus, getFavoriteMenus, saveFavoriteMenus } from '#/api/system/home';

import { version as buildVersion } from '../../../../../package.json';
import Schedule from './schedule.vue';
import { defaultLayout, layoutKey, parseLayout, widgetTitles } from './workbench';

defineOptions({ name: 'HomeWorkbench' });
const router = useRouter();
const user = useUserStore().userInfo as AdminUserInfo;
const key = layoutKey(user.currentTenantId ?? user.tenantId, user.userId);
const layout = ref(defaultLayout());
const draft = ref(defaultLayout());
const customizing = ref(false);
const configError = ref('');
const clock = ref(new Date());
const controller = new AbortController();
const generation = sessionBoundary.version;
const valid = () => !controller.signal.aborted && generation === sessionBoundary.version;
let timer: ReturnType<typeof setInterval>;
const menus = ref<MenuOutput[]>([]);
const favorites = ref<Array<number | string>>([]);
const favoriteDraft = ref<Array<number | string>>([]);
const favoritesOpen = ref(false);
const favoritesLoading = ref(true);
const favoritesSaving = ref(false);
const favoritesError = ref('');
const favoriteItems = computed(() => favorites.value.map((id) => menus.value.find((menu) => String(menu.id) === String(id))).filter((menu): menu is MenuOutput => !!menu));
const availableWidgets = computed(() => (Object.keys(widgetTitles) as WidgetKey[]).filter((item) => !draft.value.widgets.flat().includes(item)));
const commitLoading = ref(false);
const commitError = ref('');
const commits = ref<Array<{ title: string; time: string; url: string }>>([]);
const clone = (value: WorkbenchLayout) => JSON.parse(JSON.stringify(value)) as WorkbenchLayout;

function flatten(tree: MenuOutput[]): MenuOutput[] {
	return tree.flatMap((item) => {
		if (item.status !== 1 || item.meta?.isHide) return [];
		if (item.children?.length) return flatten(item.children);
		return item.type === 2 && item.id && item.path ? [item] : [];
	});
}
async function loadFavorites() {
	favoritesLoading.value = true;
	favoritesError.value = '';
	try {
		const [tree, saved] = await Promise.all([getAvailableMenus(controller.signal), getFavoriteMenus(controller.signal)]);
		if (!valid()) return;
		menus.value = flatten(tree);
		favorites.value = saved.flatMap((item) => (item.id ? [item.id] : []));
	} catch (cause) {
		if (valid()) favoritesError.value = cause instanceof Error ? cause.message : '快捷入口加载失败';
	} finally {
		if (valid()) favoritesLoading.value = false;
	}
}
async function saveFavorites() {
	if (favoritesSaving.value || !valid()) return;
	favoritesSaving.value = true;
	favoritesError.value = '';
	try {
		await saveFavoriteMenus(favoriteDraft.value, controller.signal);
		if (!valid()) return;
		favorites.value = [...favoriteDraft.value];
		favoritesOpen.value = false;
	} catch (cause) {
		if (valid()) favoritesError.value = cause instanceof Error ? cause.message : '快捷入口保存失败';
	} finally {
		if (valid()) favoritesSaving.value = false;
	}
}
function navigate(menu: MenuOutput) {
	const path = menu.path;
	if (!path) return;
	if (/^https?:\/\//i.test(path)) window.open(path, '_blank', 'noopener,noreferrer');
	else if (path.startsWith('/') && !path.startsWith('//')) void router.push(path);
}
function moveFavorite(index: number, direction: number) {
	const target = index + direction;
	if (target < 0 || target >= favoriteDraft.value.length || favoritesSaving.value) return;
	const [id] = favoriteDraft.value.splice(index, 1);
	if (id !== undefined) favoriteDraft.value.splice(target, 0, id);
}
function configure() {
	draft.value = clone(layout.value);
	configError.value = '';
	customizing.value = true;
}
function changeColumns(value: number) {
	const widgets = draft.value.widgets.flat();
	draft.value = { columns: value === 1 ? [24] : value === 2 ? [12, 12] : [12, 6, 6], widgets: Array.from({ length: value }, (_, index) => widgets.filter((_, i) => i % value === index)) };
}
function move(column: number, index: number, direction: number) {
	const items = draft.value.widgets[column]!;
	const item = items[index];
	if (!item || index + direction < 0 || index + direction >= items.length) return;
	items.splice(index, 1);
	items.splice(index + direction, 0, item);
}
function moveColumn(column: number, index: number) {
	const [item] = draft.value.widgets[column]!.splice(index, 1);
	if (item) draft.value.widgets[(column + 1) % draft.value.columns.length]!.push(item);
}
function saveLayout() {
	if (!valid()) return;
	try {
		localStorage.setItem(key, JSON.stringify(draft.value));
		layout.value = clone(draft.value);
		customizing.value = false;
	} catch {
		configError.value = '工作台配置无法保存，请检查浏览器存储空间后重试';
	}
}
async function loadCommits() {
	if (commitLoading.value) return;
	commitLoading.value = true;
	commitError.value = '';
	try {
		// 公共项目记录不使用业务请求客户端，防止携带认证令牌。
		const response = await fetch('https://gitee.com/api/v5/repos/zuohuaijun/Admin.NET/commits?page=1&per_page=10', {
			credentials: 'omit',
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
		});
		if (!response.ok) throw new Error('更新记录暂时无法加载');
		const data = await response.json();
		if (!Array.isArray(data)) throw new Error('更新记录格式无效');
		if (valid())
			commits.value = data.map((item) => ({
				title: String(item.commit?.message ?? ''),
				time: String(item.commit?.committer?.date ?? ''),
				url: /^https:\/\/gitee\.com\//.test(String(item.html_url)) ? item.html_url : '',
			}));
	} catch {
		if (valid()) commitError.value = '更新记录暂时无法加载，可重试或前往项目仓库查看';
	} finally {
		if (valid()) commitLoading.value = false;
	}
}
onMounted(() => {
	try {
		layout.value = parseLayout(localStorage.getItem(key));
	} catch {
		configError.value = '无法读取工作台配置，已使用默认布局';
	}
	timer = setInterval(() => {
		clock.value = new Date();
	}, 1000);
	void loadFavorites();
	void loadCommits();
});
onScopeDispose(() => {
	clearInterval(timer);
	controller.abort();
});
</script>

<template>
	<section class="workbench">
		<header class="workbench-header">
			<div>
				<h1>工作台</h1>
				<p>{{ user.realName || user.username }}，欢迎回来</p>
			</div>
			<div class="workbench-actions"><Button @click="router.push('/dashboard/notice')">通知中心</Button><Button @click="configure">自定义工作台</Button></div>
		</header>
		<Alert v-if="configError && !customizing" type="warning" :title="configError" />
		<div class="workbench-grid" :style="{ gridTemplateColumns: layout.columns.map((width) => `minmax(0, ${width}fr)`).join(' ') }">
			<div v-for="(column, columnIndex) in layout.widgets" :key="columnIndex" class="workbench-column">
				<Card v-for="widget in column" :key="widget" :title="widgetTitles[widget]" :data-widget="widget">
					<template v-if="widget === 'welcome'">
						<h2>欢迎使用 {{ preferences.app.name || 'Admin.NET' }}</h2>
						<p class="workbench-description">在这里管理个人日程和快捷入口。通过“自定义工作台”调整组件及布局。</p>
						<Button href="https://adminnet.top/" target="_blank" rel="noopener noreferrer">文档教程</Button>
					</template>
					<template v-else-if="widget === 'myapp'">
						<Alert v-if="favoritesError" type="error" :title="favoritesError" />
						<p v-if="favoritesLoading" role="status">正在加载快捷入口……</p>
						<div v-else class="workbench-actions">
							<Button v-for="menu in favoriteItems" :key="menu.id" @click="navigate(menu)">{{ menu.meta?.title || menu.name }}</Button>
							<span v-if="!favoriteItems.length && !favoritesError">暂无快捷入口</span>
						</div>
						<div class="workbench-actions mt-4">
							<Button
								:disabled="favoritesLoading || !!favoritesError"
								@click="
									favoriteDraft = [...favorites];
									favoritesOpen = true;
								"
								>配置快捷入口</Button
							>
							<Button :loading="favoritesLoading" @click="loadFavorites">刷新快捷入口</Button>
						</div>
					</template>
					<Schedule v-else-if="widget === 'schedule'" />
					<template v-else-if="widget === 'timer'"
						><time class="workbench-clock">{{ clock.toLocaleTimeString() }}</time>
						<p>{{ clock.toLocaleDateString() }}</p></template
					>
					<template v-else-if="widget === 'about'"
						><p>Admin.NET 是基于 ASP.NET Core 的通用权限开发框架，支持多租户、权限管理、消息与任务调度。</p>
						<Button class="mt-4" @click="router.push('/about')">关于项目</Button></template
					>
					<template v-else-if="widget === 'version'"
						><p>Admin.NET 当前前端版本：{{ buildVersion }}</p>
						<p class="workbench-description">Vue 3 · Vben · Antdv-Next</p>
						<a href="https://gitee.com/zuohuaijun/Admin.NET" target="_blank" rel="noopener noreferrer">项目仓库</a></template
					>
					<template v-else-if="widget === 'commit'">
						<Alert v-if="commitError" type="warning" :title="commitError" />
						<p v-if="!commits.length && !commitError" class="workbench-description">查看 Admin.NET 公共项目的更新记录。</p>
						<ul class="workbench-commits">
							<li v-for="item in commits" :key="item.url">
								<a :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.title }}</a
								><time>{{ item.time }}</time>
							</li>
						</ul>
						<Button :loading="commitLoading" @click="loadCommits">加载更新记录</Button>
					</template>
				</Card>
			</div>
		</div>
		<p v-if="layout.widgets.flat().length === 0">当前未显示组件，可通过“自定义工作台”添加。</p>
		<Modal v-model:open="customizing" title="自定义工作台" :width="760" ok-text="保存布局" :mask-closable="false" @ok="saveLayout">
			<Alert v-if="configError" type="error" :title="configError" />
			<div class="workbench-actions mb-4">
				<label for="workbench-columns">列布局</label>
				<Select
					id="workbench-columns"
					:value="draft.columns.length"
					:options="[
						{ value: 1, label: '单列' },
						{ value: 2, label: '双列' },
						{ value: 3, label: '三列' },
					]"
					@change="(value) => changeColumns(Number(value))"
				/>
				<Button @click="draft = defaultLayout()">恢复默认布局</Button>
			</div>
			<div v-for="(column, columnIndex) in draft.widgets" :key="columnIndex" class="workbench-config">
				<h3>第 {{ columnIndex + 1 }} 列</h3>
				<div v-for="(widget, index) in column" :key="widget" class="workbench-config-row">
					<span>{{ widgetTitles[widget] }}</span>
					<Button size="small" :aria-label="`上移${widgetTitles[widget]}`" :disabled="index === 0" @click="move(columnIndex, index, -1)">上移</Button>
					<Button size="small" :aria-label="`下移${widgetTitles[widget]}`" :disabled="index === column.length - 1" @click="move(columnIndex, index, 1)">下移</Button>
					<Button v-if="draft.columns.length > 1" size="small" :aria-label="`移列${widgetTitles[widget]}`" @click="moveColumn(columnIndex, index)">移至下一列</Button>
					<Button size="small" danger :aria-label="`隐藏${widgetTitles[widget]}`" @click="column.splice(index, 1)">隐藏</Button>
				</div>
			</div>
			<div class="workbench-actions">
				<Button v-for="widget in availableWidgets" :key="widget" @click="draft.widgets[0]!.push(widget)">添加{{ widgetTitles[widget] }}</Button>
			</div>
		</Modal>
		<Modal
			:open="favoritesOpen"
			title="配置快捷入口"
			ok-text="保存快捷入口"
			:confirm-loading="favoritesSaving"
			:closable="!favoritesSaving"
			:keyboard="!favoritesSaving"
			:mask-closable="false"
			:cancel-button-props="{ disabled: favoritesSaving }"
			@ok="saveFavorites"
			@cancel="favoritesOpen = false"
		>
			<Alert v-if="favoritesError" type="error" :title="favoritesError" />
			<CheckboxGroup
				v-model:value="favoriteDraft"
				:disabled="favoritesSaving"
				class="workbench-favorites"
				:options="menus.map((item) => ({ label: item.meta?.title || item.name || '', value: item.id! }))"
			/>
			<div v-for="(id, index) in favoriteDraft" :key="id" class="workbench-config-row">
				<span>{{ menus.find((item) => String(item.id) === String(id))?.meta?.title }}</span>
				<Button size="small" :disabled="favoritesSaving || index === 0" :aria-label="`上移快捷入口${index + 1}`" @click="moveFavorite(index, -1)">上移</Button>
				<Button size="small" :disabled="favoritesSaving || index === favoriteDraft.length - 1" :aria-label="`下移快捷入口${index + 1}`" @click="moveFavorite(index, 1)">下移</Button>
			</div>
			<p class="mt-4">仅展示当前身份有权访问的菜单。取消全部选择后保存可清空快捷入口。</p>
		</Modal>
	</section>
</template>

<style scoped>
.workbench {
	padding: 20px;
}
.workbench-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	margin-bottom: 20px;
}
.workbench-header h1 {
	font-size: 24px;
	font-weight: 600;
	margin-bottom: 8px;
}
.workbench-grid {
	display: grid;
	gap: 20px;
	align-items: start;
}
.workbench-column {
	display: grid;
	gap: 20px;
	min-width: 0;
}
.workbench-actions {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	align-items: center;
}
.workbench-description {
	margin: 12px 0;
	color: hsl(var(--muted-foreground));
}
.workbench-clock {
	font-size: 32px;
	font-variant-numeric: tabular-nums;
}
.workbench-config {
	margin-bottom: 16px;
}
.workbench-config-row {
	display: flex;
	gap: 8px;
	margin-top: 8px;
	align-items: center;
}
.workbench-config-row > span {
	flex: 1;
}
.workbench-favorites {
	display: flex;
	flex-direction: column;
	gap: 12px;
	max-height: 45vh;
	overflow: auto;
}
.workbench-commits {
	overflow-wrap: anywhere;
}
.workbench-commits li {
	margin-bottom: 12px;
}
.workbench-commits time {
	display: block;
	color: hsl(var(--muted-foreground));
	font-size: 12px;
}
@media (max-width: 900px) {
	.workbench-grid {
		grid-template-columns: minmax(0, 1fr) !important;
	}
	.workbench-header {
		flex-wrap: wrap;
	}
}
</style>
