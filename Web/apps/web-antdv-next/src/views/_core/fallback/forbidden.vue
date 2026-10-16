<script lang="ts" setup>
import { useRouter } from 'vue-router';

import { Fallback } from '@vben/common-ui';

import { Button } from 'antdv-next';

import { useAuthStore } from '#/store';

defineOptions({ name: 'Fallback403Demo' });

const router = useRouter();
const auth = useAuthStore();
</script>

<template>
  <Fallback status="403">
    <template #action>
      <div class="flex gap-3">
        <Button size="large" @click="router.push('/')">返回首页</Button>
        <Button type="primary" size="large" @click="auth.reauthorize()">重新授权</Button>
      </div>
    </template>
  </Fallback>
</template>
