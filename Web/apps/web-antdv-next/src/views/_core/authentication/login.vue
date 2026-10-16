<script setup lang="ts">
import type { FormInstance } from "antdv-next";

import type { AuthApi } from "#/api/core/auth";

import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  reactive,
  ref,
} from "vue";
import { useRoute, useRouter } from "vue-router";

import { SliderCaptcha } from "@vben/common-ui";

import {
  Alert,
  Button,
  Form,
  FormItem,
  Input,
  InputPassword,
  Select,
  Spin,
} from "antdv-next";

import {
  getCaptchaApi,
  getSystemInfoApi,
  getTenantOptionsApi,
  isEnabled,
} from "#/api";
import { useAuthStore } from "#/store";
import { applySiteBrand } from "#/utils/site-brand";

import { useCaptchaExpiry } from "./components/use-captcha-expiry";

defineOptions({ name: "Login" });
const store = useAuthStore();
const router = useRouter();
const route = useRoute();
const info = ref<AuthApi.SystemInfo>();
const tenants = ref<AuthApi.TenantOption[]>([]);
const captcha = ref<AuthApi.Captcha>();
const captchaExpiry = useCaptchaExpiry();
const { remainingSeconds: captchaSeconds, expired: captchaExpired } =
  captchaExpiry;
const captchaLoading = ref(false);
const verified = ref(false);
const loginForm = ref<FormInstance>();
const sliderControl = ref<InstanceType<typeof SliderCaptcha>>();
const continuationPending = ref(false);
const loading = ref(true);
const errorMessage = ref("");
const capsLockActive = ref(false);
function updateCapsLock(event: KeyboardEvent) {
  capsLockActive.value = event.getModifierState("CapsLock");
}
const form = reactive<AuthApi.LoginParams>({
  account: "",
  password: "",
  code: "",
  tenantId: undefined,
});
const requireCaptcha = computed(() => isEnabled(info.value?.captcha));
let generation = 0;
let captchaGeneration = 0;
function clearCaptcha() {
  captchaGeneration++;
  continuationPending.value = false;
  captchaExpiry.stop();
  captchaLoading.value = false;
  captcha.value = undefined;
  form.codeId = undefined;
  form.code = "";
}

async function loadTenantInfo() {
  const current = ++generation;
  clearCaptcha();
  loading.value = true;
  info.value = undefined;
  verified.value = false;
  errorMessage.value = "";
  try {
    const result = await getSystemInfoApi(form.tenantId);
    if (current !== generation) return;
    info.value = result;
    applySiteBrand(result);
    await refreshCaptcha();
  } catch (error) {
    if (current === generation)
      errorMessage.value =
        error instanceof Error ? error.message : "无法加载登录配置";
  } finally {
    if (current === generation) loading.value = false;
  }
}

async function refreshCaptcha() {
  clearCaptcha();
  if (!requireCaptcha.value) return;
  const current = captchaGeneration;
  const version = generation;
  captchaLoading.value = true;
  try {
    const result = await getCaptchaApi();
    if (current !== captchaGeneration || version !== generation) return;
    captcha.value = result;
    form.codeId = result.id;
    captchaExpiry.arm(result.expirySeconds);
  } finally {
    if (current === captchaGeneration && version === generation)
      captchaLoading.value = false;
  }
}

async function initialize() {
  const current = ++generation;
  loading.value = true;
  errorMessage.value = "";
  try {
    const initial = await getSystemInfoApi();
    if (current !== generation) return;
    info.value = initial;
    if (!info.value.hideTenantForLogin) {
      const options = await getTenantOptionsApi();
      if (current !== generation) return;
      tenants.value = options;
      const host = window.location.hostname.toLowerCase();
      const matchingTenant = tenants.value.find((item) => item.host === host);
      const requested = tenants.value.find(
        (item) => String(item.value) === route.query.tenantId,
      );
      form.tenantId =
        requested?.value ?? matchingTenant?.value ?? tenants.value[0]?.value;
    }
    await loadTenantInfo();
  } catch (error) {
    if (current === generation)
      errorMessage.value =
        error instanceof Error ? error.message : "无法加载登录配置";
  } finally {
    if (current === generation) loading.value = false;
  }
}

async function continueAfterSliderSuccess() {
  if (
    continuationPending.value ||
    store.loginLoading ||
    loading.value ||
    captchaLoading.value
  )
    return;
  const current = generation;
  continuationPending.value = true;
  await nextTick();
  if (
    current !== generation ||
    !verified.value ||
    !info.value ||
    loading.value ||
    captchaLoading.value ||
    store.loginLoading ||
    !loginForm.value
  ) {
    continuationPending.value = false;
    return;
  }
  // 公开 Form.submit 执行原表单校验，校验成功后由原 finish 消费者提交。
  loginForm.value.submit();
}

function handleValidationFailed() {
  continuationPending.value = false;
}

async function submit() {
  const current = generation;
  try {
    if (
      loading.value ||
      captchaLoading.value ||
      store.loginLoading ||
      !info.value
    )
      return;
    errorMessage.value = "";
    if (requireCaptcha.value && (!captcha.value || captchaExpired.value)) {
      errorMessage.value = "验证码已过期，请刷新后再登录";
      await refreshCaptcha().catch(() => undefined);
      return;
    }
    if (isEnabled(info.value?.secondVer) && !verified.value) {
      errorMessage.value = "请先完成验证";
      return;
    }
    try {
      await store.authLogin({ ...form });
    } catch (error) {
      if (current !== generation) return;
      errorMessage.value = error instanceof Error ? error.message : "登录失败";
      verified.value = false;
      await nextTick();
      if (current !== generation) return;
      sliderControl.value?.resume();
      await refreshCaptcha().catch(() => undefined);
    }
  } finally {
    if (current === generation) continuationPending.value = false;
  }
}

onMounted(() => {
  if (route.path === "/auth/login" && route.query.wayid !== undefined) {
    void router.replace({ path: "/auth/register", query: { ...route.query } });
    return;
  }
  void initialize();
});
let activated = false;
onActivated(() => {
  if (activated) void initialize();
  activated = true;
});
onDeactivated(() => {
  generation++;
  clearCaptcha();
});
onBeforeUnmount(() => {
  generation++;
  clearCaptcha();
});
</script>

<template>
  <section class="login-form">
    <h1>登录 {{ info?.title || "Admin.NET" }}</h1>
    <Alert
      v-if="errorMessage"
      :message="errorMessage"
      type="error"
      show-icon
      class="mb-4"
    />
    <Spin :spinning="loading">
      <Form
        ref="loginForm"
        :model="form"
        layout="vertical"
        :scroll-to-first-error="{ focus: true }"
        @finish="submit"
        @finish-failed="handleValidationFailed"
      >
        <FormItem
          v-if="tenants.length"
          name="tenantId"
          label="租户"
          :rules="[{ required: true, message: '请选择租户' }]"
        >
          <Select
            v-model:value="form.tenantId"
            :options="tenants"
            show-search
            option-filter-prop="label"
            @change="loadTenantInfo"
          />
        </FormItem>
        <FormItem
          name="account"
          label="账号"
          :rules="[{ required: true, message: '请输入账号' }]"
        >
          <Input
            v-model:value="form.account"
            autocomplete="username"
            size="large"
          />
        </FormItem>
        <FormItem
          name="password"
          label="密码"
          html-for="password"
          :rules="[{ required: true, message: '请输入密码' }]"
        >
          <InputPassword
            id="password"
            v-model:value="form.password"
            autocomplete="current-password"
            size="large"
            @keydown="updateCapsLock"
            @keyup="updateCapsLock"
            @blur="capsLockActive = false"
          />
          <template #extra>
            <p v-if="capsLockActive" role="status" aria-live="polite" class="mt-2 text-amber-600 dark:text-amber-400">
              大写锁定已开启
            </p>
          </template>
        </FormItem>
        <FormItem
          v-if="requireCaptcha"
          name="code"
          label="验证码"
          html-for="code"
          :rules="[{ required: true, message: '请输入验证码' }]"
        >
          <div class="captcha-row">
            <Input
              id="code"
              v-model:value="form.code"
              autocomplete="off"
              size="large"
            />
            <button
              type="button"
              class="captcha-image"
              :class="{ expired: captchaExpired }"
              :disabled="captchaLoading"
              aria-label="刷新验证码"
              @click="refreshCaptcha"
            >
              <img
                v-if="captcha"
                :src="`data:image/png;base64,${captcha.img}`"
                alt="验证码"
                width="130"
                height="38"
              />
            </button>
          </div>
          <p
            v-if="captcha"
            class="captcha-expiry"
            role="status"
            aria-live="polite"
          >
            {{
              captchaExpired
                ? "验证码已过期，点击图片刷新"
                : `验证码将在 ${captchaSeconds} 秒后过期`
            }}
          </p>
        </FormItem>
        <SliderCaptcha
          ref="sliderControl"
          v-if="isEnabled(info?.secondVer)"
          v-model="verified"
          class="slider-captcha mb-6"
          @success="continueAfterSliderSuccess"
        />
        <Button
          type="primary"
          html-type="submit"
          size="large"
          block
          :loading="store.loginLoading || continuationPending"
          :disabled="
            loading ||
            !info ||
            captchaLoading ||
            store.loginLoading ||
            continuationPending ||
            (requireCaptcha && !captcha)
          "
          >登录</Button
        >
      </Form>
    </Spin>
    <div class="mt-4 flex justify-between">
      <Button
        type="link"
        @click="router.push({ path: '/auth/code-login', query: route.query })"
        >手机登录</Button
      >
      <Button
        type="link"
        @click="router.push({ path: '/auth/qrcode-login', query: route.query })"
        >项目二维码</Button
      >
      <Button
        v-if="isEnabled(info?.enableReg)"
        type="link"
        @click="
          router.push({
            path: '/auth/register',
            query: { ...route.query, tenantId: form.tenantId },
          })
        "
        >注册账号</Button
      >
      <Button v-if="!info && !loading" type="link" @click="initialize"
        >重新加载</Button
      >
    </div>
  </section>
</template>

<style scoped>
.login-form {
  width: 100%;
  max-width: 420px;
  margin: auto;
}
h1 {
  margin-bottom: 24px;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0;
}
.captcha-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px;
  gap: 12px;
}
.captcha-image {
  height: 40px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--ant-color-border);
  border-radius: 4px;
}
.captcha-image.expired img {
  filter: grayscale(1);
  opacity: 0.45;
}
.captcha-expiry {
  margin-top: 6px;
  color: var(--ant-color-text-secondary);
  font-size: 12px;
}
</style>
