<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";

import { Button, QRCode } from "antdv-next";

const route = useRoute();
const router = useRouter();
const projectUrl = "https://gitee.com/zuohuaijun/Admin.NET";
function returnToAccount() {
  const query = { ...route.query };
  delete query.wayid;
  void router.replace({ path: "/auth/login", query });
}
</script>

<template>
  <section class="project-qrcode mx-auto w-full max-w-md">
    <h1 class="mb-6 text-2xl font-semibold">项目二维码</h1>
    <div class="flex justify-center">
      <QRCode :value="projectUrl" type="svg" :size="260" error-level="M" />
    </div>
    <p class="mt-4 text-center">扫描二维码查看 Admin.NET 项目。</p>
    <a
      :href="projectUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="mt-2 block text-center"
      >Admin.NET 项目</a
    >
    <Button class="mt-6" @click="returnToAccount">返回账号登录</Button>
  </section>
</template>
