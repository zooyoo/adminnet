<script setup lang="ts">
import { Button, Card } from 'antdv-next';

import { version } from '../../../../../package.json';
</script>

<template>
	<section class="m-5">
		<Card title="关于 Admin.NET">
			<p class="mb-4">基于 ASP.NET Core、Furion 与 SqlSugar 的通用权限开发框架，前端采用 Vue 3、Vben 和 Antdv-Next。</p>
			<p class="mb-4">支持多租户、身份认证、权限管理、文件、通知与任务调度。当前前端版本：{{ version }}。</p>
			<p class="mb-4">项目遵循 MIT 与 Apache-2.0 许可证，使用时请遵守源码中的许可约定。</p>
			<div class="flex flex-wrap gap-3">
				<Button href="https://adminnet.top/" target="_blank" rel="noopener noreferrer">项目文档</Button>
				<Button href="https://gitee.com/zuohuaijun/Admin.NET" target="_blank" rel="noopener noreferrer">项目仓库</Button>
				<Button @click="$router.push('/home')">返回工作台</Button>
			</div>
		</Card>
	</section>
</template>
