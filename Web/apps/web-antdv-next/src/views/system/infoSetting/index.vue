<script setup lang="ts">
import type { InfoSaveInput } from '#/api-services/models';

import { onBeforeUnmount, onMounted, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon } from '@vben/icons';
import { updatePreferences } from '@vben/preferences';

import { Alert, Button, Form, FormItem, Image, Input, message, RadioGroup, Select, Spin, Upload } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { getSiteInfo, saveSiteInfo, siteDraft } from '#/api/system/site-info';
import { siteLogoUrl } from '#/utils/site-logo';
import { logoAsDataUrl } from '#/views/system/tenant/tenant-form';

defineOptions({ name: 'SysInfoSetting' });
const Save = createIconifyIcon('lucide:save');
const Refresh = createIconifyIcon('lucide:refresh-cw');
const { hasAccessByCodes } = useAccess();
const loading = ref(true);
const saving = ref(false);
const reading = ref(false);
const error = ref('');
const value = ref<InfoSaveInput>(siteDraft());
const logo = ref('');
const logoName = ref('');
const ways = ref<Array<{ label: string; value: number }>>([]);
let generation = 0;
let editorSession = sessionBoundary.version;
let logoGeneration = 0;

async function load() {
	const current = ++generation;
	const version = sessionBoundary.version;
	editorSession = version;
	logoGeneration++;
	loading.value = true;
	error.value = '';
	try {
		const info = await getSiteInfo();
		if (current !== generation || version !== sessionBoundary.version) return;
		value.value = siteDraft(info);
		logo.value = siteLogoUrl(info.logo);
		logoName.value = '';
		ways.value = info.wayList ?? [];
	} catch (cause) {
		if (current === generation) error.value = cause instanceof Error ? cause.message : '系统信息加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}
async function selectLogo(file: File) {
	if (loading.value || saving.value || error.value || editorSession !== sessionBoundary.version) return false;
	if (!['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
		message.warning('请选择 PNG、JPEG、GIF 或 WebP 图片');
		return false;
	}
	if (file.size > 5 * 1024 * 1024) {
		message.warning('Logo 不能超过 5 MB');
		return false;
	}
	const current = generation;
	const selection = ++logoGeneration;
	const version = editorSession;
	reading.value = true;
	try {
		const data = await logoAsDataUrl(file);
		if (current === generation && selection === logoGeneration && version === sessionBoundary.version) {
			value.value.logoBase64 = data;
			value.value.logoFileName = file.name;
			logoName.value = file.name;
		}
	} catch (cause) {
		message.error(cause instanceof Error ? cause.message : 'Logo 读取失败');
	} finally {
		if (current === generation && selection === logoGeneration) reading.value = false;
	}
	return false;
}
function cancelLogo() {
	logoGeneration++;
	reading.value = false;
	value.value.logoBase64 = undefined;
	value.value.logoFileName = undefined;
	logoName.value = '';
}
async function save() {
	if (saving.value || loading.value || reading.value || error.value || editorSession !== sessionBoundary.version || !hasAccessByCodes(['sysConfig:saveSysInfo'])) return;
	if (value.value.enableReg === 1 && !value.value.regWayId) {
		message.warning('请选择注册方案');
		return;
	}
	saving.value = true;
	const current = generation;
	const version = editorSession;
	try {
		await saveSiteInfo({ ...value.value, regWayId: value.value.enableReg === 1 ? value.value.regWayId : undefined });
		if (current !== generation || version !== sessionBoundary.version) return;
		message.success('系统信息已保存');
		await load();
		if (!error.value && version === sessionBoundary.version) {
			updatePreferences({
				app: { name: value.value.title || 'Admin.NET' },
				logo: { source: logo.value || `${import.meta.env.BASE_URL}logo.png`, sourceDark: logo.value || `${import.meta.env.BASE_URL}logo.png` },
			});
		}
	} catch {
		/* 请求层提示错误，保留表单数据。 */
	} finally {
		saving.value = false;
	}
}
onMounted(load);
onBeforeUnmount(() => {
	generation += 1;
});
</script>

<template>
	<section class="site-info-page">
		<header>
			<h1>系统信息配置</h1>
			<Button :disabled="saving || reading" :loading="loading" aria-label="重新加载系统信息" @click="load"><Refresh :size="16" /></Button>
		</header>
		<Alert v-if="error" :message="error" type="error" show-icon class="mb-4" />
		<Spin :spinning="loading">
			<Form name="site-info" :model="value" layout="vertical" :disabled="loading || !!error || saving" @finish="save">
				<FormItem name="logoBase64" label="系统图标"
					><div class="logo-row">
						<Image v-if="value.logoBase64 || logo" :src="value.logoBase64 || logo" :width="88" :height="88" />
						<Upload accept="image/png,image/jpeg,image/gif,image/webp" :show-upload-list="false" :before-upload="selectLogo" :disabled="loading || saving || reading || !!error"
							><Button :loading="reading" :disabled="loading || saving">选择 Logo</Button></Upload
						><span>{{ logoName }}</span>
						<Button v-if="value.logoBase64 || reading" :disabled="saving" @click="cancelLogo">取消 Logo 更改</Button>
					</div></FormItem
				>
				<div class="field-grid">
					<FormItem name="title" label="系统主标题"><Input v-model:value="value.title" /></FormItem>
					<FormItem name="viceTitle" label="系统副标题"><Input v-model:value="value.viceTitle" /></FormItem>
					<FormItem name="icp" label="ICP 备案号"><Input v-model:value="value.icp" /></FormItem>
					<FormItem name="icpUrl" label="ICP 地址"><Input v-model:value="value.icpUrl" /></FormItem>
				</div>
				<FormItem name="viceDesc" label="系统描述"><Input v-model:value="value.viceDesc" /></FormItem>
				<FormItem name="watermark" label="水印内容"><Input v-model:value="value.watermark" allow-clear /></FormItem>
				<FormItem name="copyright" label="版权说明"><Input v-model:value="value.copyright" /></FormItem>
				<FormItem name="enableReg" label="用户注册"
					><RadioGroup
						v-model:value="value.enableReg"
						:options="[
							{ label: '启用', value: 1 },
							{ label: '禁用', value: 2 },
						]"
				/></FormItem>
				<FormItem v-if="value.enableReg === 1" name="regWayId" label="注册方案" :rules="[{ required: true, message: '请选择注册方案' }]"
					><Select v-model:value="value.regWayId" :options="ways" :virtual="false" allow-clear
				/></FormItem>
				<Button v-if="hasAccessByCodes(['sysConfig:saveSysInfo'])" type="primary" html-type="submit" :loading="saving" :disabled="reading || loading || !!error"><Save :size="16" />保存</Button>
			</Form>
		</Spin>
	</section>
</template>

<style scoped>
.site-info-page {
	padding: 20px;
	max-width: 960px;
	width: 100%;
}
header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 18px;
}
h1 {
	font-size: 18px;
	font-weight: 600;
}
.field-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0 16px;
}
.logo-row {
	display: flex;
	align-items: center;
	gap: 16px;
	flex-wrap: wrap;
}
@media (max-width: 640px) {
	.field-grid {
		grid-template-columns: minmax(0, 1fr);
	}
	.site-info-page {
		padding: 16px;
	}
}
</style>
