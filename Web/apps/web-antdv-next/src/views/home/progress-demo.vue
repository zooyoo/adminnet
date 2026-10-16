<script setup lang="ts">
import { Progress } from 'antdv-next';
</script>

<template>
	<div class="flex flex-col items-center gap-2" data-testid="progress-demo">
		<div role="img" aria-label="项目进度演示：99.9%">
			<Progress type="dashboard" :percent="99.9" :size="160" aria-hidden="true" />
		</div>
		<p>当前进度</p>
		<p class="text-muted-foreground text-sm">项目进度演示，固定为 99.9%。</p>
	</div>
</template>
