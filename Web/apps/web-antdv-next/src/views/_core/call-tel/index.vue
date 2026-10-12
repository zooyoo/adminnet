<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Alert, Button, Card } from 'antdv-next';

import { parseDialContact } from './call-tel';

defineOptions({ name: 'CallTel' });

const route = useRoute();
const router = useRouter();
const contact = computed(() => parseDialContact(route.query.code));

watch(() => route.query.token, () => {
  if (!Object.hasOwn(route.query, 'token')) return;
  const query = Object.fromEntries(Object.entries(route.query).filter(([key]) => key !== 'token'));
  void router.replace({ path: route.path, query }).catch(() => {});
}, { immediate: true });
</script>

<template>
  <main class="call-tel-page">
    <Card class="call-tel-card" title="拨打电话">
      <template v-if="contact">
        <p v-if="contact.name" class="contact-name">{{ contact.name }}</p>
        <p class="contact-number">{{ contact.number }}</p>
        <Button type="primary" size="large" :href="contact.href" aria-label="拨打电话">拨打电话</Button>
      </template>
      <Alert v-else title="拨号信息无效，请重新打开联系人链接。" type="error" role="alert" />
    </Card>
  </main>
</template>

<style scoped>
.call-tel-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
  background: hsl(var(--background));
}
.call-tel-card { width: min(100%, 480px); text-align: center; }
.contact-name { margin-bottom: 12px; font-size: 24px; overflow-wrap: anywhere; }
.contact-number { margin-bottom: 24px; font-size: 20px; overflow-wrap: anywhere; }
</style>
