<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from 'vue';

import { Button, Card } from 'antdv-next';

import { getSystemInfoApi } from '#/api/core/auth';

import packageJson from '../../../../../package.json';

declare const __VBEN_ADMIN_METADATA__: {
	buildTime: string;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
	description?: string;
};
const metadata = __VBEN_ADMIN_METADATA__;
const siteInfo = ref<Awaited<ReturnType<typeof getSystemInfoApi>>>();
const author = typeof packageJson.author === 'object' ? packageJson.author.name : packageJson.author;
let active = true;
onMounted(async () => {
	try {
		const info = await getSystemInfoApi();
		if (active) siteInfo.value = info;
	} catch {
		/* 站点读取失败时保留实际 package 信息。 */
	}
});
onScopeDispose(() => {
	active = false;
});
</script>

<template>
	<section class="m-5 space-y-4">
		<Card title="关于 Admin.NET">
			<dl class="about-metadata grid gap-4 sm:grid-cols-2">
				<div>
					<dt>名称及作者</dt>
					<dd>{{ packageJson.name }} / {{ author }}</dd>
				</div>
				<div>
					<dt>框架描述</dt>
					<dd>
						{{ metadata.description || siteInfo?.viceDesc || siteInfo?.viceTitle || '项目未提供描述' }}
					</dd>
				</div>
				<div>
					<dt>当前版本与许可证</dt>
					<dd>{{ packageJson.version }} / {{ packageJson.license }}</dd>
				</div>
				<div>
					<dt>发布时间</dt>
					<dd>{{ metadata.buildTime }}</dd>
				</div>
				<div class="sm:col-span-2">
					<dt>关键词</dt>
					<dd>{{ packageJson.keywords.join('、') }}</dd>
				</div>
			</dl>
			<div class="about-links mt-5 flex flex-wrap gap-3">
				<Button href="https://gitee.com/zuohuaijun/Admin.NET" target="_blank" rel="noopener noreferrer">Gitee 仓库</Button>
				<Button href="https://github.com/zuohuaijun/Admin.NET.git" target="_blank" rel="noopener noreferrer">GitHub 仓库</Button>
				<Button href="http://101.43.53.74:5050/" target="_blank" rel="noopener noreferrer">项目文档</Button>
				<Button href="http://101.43.53.74:5005/dist/index.html" target="_blank" rel="noopener noreferrer">在线预览</Button>
			</div>
		</Card>
		<Card title="生产环境依赖">
			<dl class="dependency-grid">
				<div v-for="(version, name) in metadata.dependencies" :key="name">
					<dt>{{ name }}</dt>
					<dd>{{ version }}</dd>
				</div>
			</dl>
		</Card>
		<Card title="开发环境依赖">
			<dl class="dependency-grid">
				<div v-for="(version, name) in metadata.devDependencies" :key="name">
					<dt>{{ name }}</dt>
					<dd>{{ version }}</dd>
				</div>
			</dl>
		</Card>
	</section>
</template>

<style scoped>
dt {
	font-weight: 600;
}
dd {
	margin: 0;
	overflow-wrap: anywhere;
}
.dependency-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	gap: 12px 24px;
}
</style>
