<script setup lang="ts">
import { ref } from 'vue';

import { createIconifyIcon } from '@vben/icons';
import { preferences } from '@vben/preferences';

import { Button, Drawer, Tooltip } from 'antdv-next';

import OnlineUserList from '#/views/system/onlineUser/index.vue';

const open = ref(false);
const Users = createIconifyIcon('lucide:users');
</script>

<template>
	<Tooltip title="在线用户">
		<Button type="text" aria-label="在线用户" @click="open = true"><Users :size="16" /></Button>
	</Tooltip>
	<Drawer v-model:open="open" title="在线用户" :size="preferences.app.isMobile ? 360 : 960" :styles="{ wrapper: { maxWidth: '100vw' } }">
		<OnlineUserList v-if="open" />
	</Drawer>
</template>
