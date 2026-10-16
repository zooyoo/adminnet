<script setup lang="ts">
import type { AuthApi } from "#/api/core/auth";

import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { SliderCaptcha } from "@vben/common-ui";

import {
  Alert,
  Button,
  Form,
  FormItem,
  Input,
  message,
  Select,
  Spin,
} from "antdv-next";

import {
  getCaptchaApi,
  getSystemInfoApi,
  getTenantOptionsApi,
  isEnabled,
  registrationApi,
  sendSmsApi,
} from "#/api";
import { useAuthStore } from "#/store";
import { applySiteBrand } from "#/utils/site-brand";

import { useCaptchaExpiry } from "./use-captcha-expiry";

const props = defineProps<{ mode: "phone" | "register" }>();
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const registering = computed(() => props.mode === "register");
const loading = ref(true);
const submitting = ref(false);
const sending = ref(false);
const seconds = ref(0);
const errorMessage = ref("");
const verified = ref(false);
const info = ref<AuthApi.SystemInfo>();
const tenants = ref<AuthApi.TenantOption[]>([]);
const captcha = ref<AuthApi.Captcha>();
const captchaExpiry = useCaptchaExpiry();
const { remainingSeconds: captchaSeconds, expired: captchaExpired } =
  captchaExpiry;
const captchaLoading = ref(false);
const form = reactive<AuthApi.RegistrationParams>({
  account: "",
  realName: "",
  phone: "",
  code: "",
});
const canRegister = computed(
  () => !registering.value || isEnabled(info.value?.enableReg),
);
let timer: ReturnType<typeof setInterval> | undefined;
let generation = 0;
let captchaGeneration = 0;

async function loadTenantInfo() {
  verified.value = false;
  const current = ++generation;
  captchaExpiry.stop();
  captchaLoading.value = false;
  captcha.value = undefined;
  form.codeId = undefined;
  loading.value = true;
  info.value = undefined;
  form.wayId = undefined;
  form.code = "";
  errorMessage.value = "";
  try {
    const result = await getSystemInfoApi(form.tenantId);
    if (current !== generation) return;
    info.value = result;
    const requested = result.wayList?.find(
      (item) => String(item.value) === route.query.wayid,
    );
    form.wayId = requested?.value ?? result.regWayId;
    applySiteBrand(result);
    if (registering.value && canRegister.value) await refreshCaptcha();
  } catch (error) {
    if (current === generation)
      errorMessage.value =
        error instanceof Error ? error.message : "无法加载登录配置";
  } finally {
    if (current === generation) loading.value = false;
  }
}

async function refreshCaptcha() {
  const current = ++captchaGeneration;
  const version = generation;
  captcha.value = undefined;
  form.codeId = undefined;
  form.code = "";
  captchaExpiry.stop();
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
      form.tenantId =
        tenants.value.find(
          (tenant) => String(tenant.value) === route.query.tenantId,
        )?.value ??
        tenants.value.find(
          (tenant) => tenant.host === window.location.hostname.toLowerCase(),
        )?.value ??
        tenants.value[0]?.value;
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

async function sendCode() {
  if (
    sending.value ||
    seconds.value > 0 ||
    loading.value ||
    !info.value ||
    submitting.value
  )
    return;
  if (!/^1\d{10}$/.test(form.phone)) {
    errorMessage.value = "请输入有效的手机号码";
    return;
  }
  sending.value = true;
  const current = generation;
  errorMessage.value = "";
  try {
    await sendSmsApi(form.phone);
    if (current !== generation) return;
    seconds.value = 60;
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      seconds.value -= 1;
      if (seconds.value <= 0) clearInterval(timer);
    }, 1000);
  } catch (error) {
    if (current === generation)
      errorMessage.value = error instanceof Error ? error.message : "发送失败";
  } finally {
    sending.value = false;
  }
}

function accountLoginQuery() {
  const query: typeof route.query = { ...route.query };
  delete query.wayid;
  return { ...query, tenantId: form.tenantId };
}

async function submit() {
  if (captchaLoading.value) return;
  if (registering.value && (!captcha.value || captchaExpired.value)) {
    errorMessage.value = "验证码已过期，请刷新后再注册";
    await refreshCaptcha().catch(() => undefined);
    return;
  }
  if (
    props.mode === "register" &&
    isEnabled(info.value?.secondVer) &&
    !verified.value
  ) {
    errorMessage.value = "请先拖动滑块完成验证";
    return;
  }
  if (
    !canRegister.value ||
    submitting.value ||
    sending.value ||
    loading.value ||
    !info.value ||
    (registering.value && !captcha.value)
  )
    return;
  const current = generation;
  submitting.value = true;
  errorMessage.value = "";
  try {
    if (registering.value) {
      await registrationApi({ ...form });
      if (current !== generation) return;
      message.success("注册成功，请使用默认密码或手机验证码登录");
      await router.replace({
        path: "/auth/login",
        query: accountLoginQuery(),
      });
    } else {
      await auth.authPhoneLogin({
        phone: form.phone,
        code: form.code,
        tenantId: form.tenantId,
      });
    }
  } catch (error) {
    if (current !== generation) return;
    errorMessage.value = error instanceof Error ? error.message : "提交失败";
    if (registering.value) await refreshCaptcha().catch(() => undefined);
  } finally {
    submitting.value = false;
  }
}

onMounted(initialize);
onUnmounted(() => {
  generation++;
  captchaGeneration++;
  captchaExpiry.stop();
  if (timer) clearInterval(timer);
});
</script>

<template>
  <section class="account-form">
    <h1>{{ registering ? "注册账号" : "手机登录" }}</h1>
    <Alert
      v-if="errorMessage"
      :message="errorMessage"
      type="error"
      show-icon
      class="mb-4"
    />
    <Alert
      v-if="info && !canRegister"
      message="当前租户未开放注册"
      type="warning"
      show-icon
      class="mb-4"
    />
    <Spin :spinning="loading">
      <Form
        :model="form"
        layout="vertical"
        :disabled="loading || submitting || sending"
        @finish="submit"
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
        <template v-if="canRegister">
          <FormItem
            v-if="registering"
            name="account"
            label="账号"
            :rules="[{ required: true, message: '请输入账号' }]"
          >
            <Input v-model:value="form.account" autocomplete="username" />
          </FormItem>
          <FormItem
            v-if="registering"
            name="realName"
            label="姓名"
            :rules="[{ required: true, message: '请输入姓名' }]"
          >
            <Input v-model:value="form.realName" autocomplete="name" />
          </FormItem>
          <FormItem
            name="phone"
            label="手机号码"
            :rules="[
              {
                required: true,
                pattern: /^1\d{10}$/,
                message: '请输入有效的手机号码',
              },
            ]"
          >
            <Input
              v-model:value="form.phone"
              autocomplete="tel"
              inputmode="tel"
            />
          </FormItem>
          <FormItem
            name="code"
            label="验证码"
            :html-for="`${props.mode}-code`"
            :rules="[{ required: true, message: '请输入验证码' }]"
          >
            <div class="code-row">
              <Input
                :id="`${props.mode}-code`"
                v-model:value="form.code"
                autocomplete="one-time-code"
              />
              <button
                v-if="registering"
                type="button"
                aria-label="刷新验证码"
                class="captcha-image"
                :class="{ expired: captchaExpired }"
                :disabled="captchaLoading"
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
              <Button
                v-else
                :disabled="seconds > 0"
                :loading="sending"
                @click="sendCode"
                >{{ seconds > 0 ? `${seconds} 秒` : "获取验证码" }}</Button
              >
            </div>
            <p
              v-if="registering && captcha"
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
          <FormItem
            v-if="registering && info?.wayList?.length"
            name="wayId"
            label="注册方案"
          >
            <Select v-model:value="form.wayId" :options="info.wayList" />
          </FormItem>
          <SliderCaptcha
            v-if="registering && isEnabled(info?.secondVer)"
            v-model="verified"
            class="slider-captcha mb-6"
          />
          <Button
            type="primary"
            html-type="submit"
            block
            size="large"
            :loading="submitting"
            :disabled="
              loading ||
              sending ||
              !info ||
              (registering && !captcha) ||
              captchaLoading
            "
          >
            {{ registering ? "注册" : "登录" }}
          </Button>
        </template>
      </Form>
    </Spin>
    <Button
      type="link"
      class="mt-4"
      @click="
        router.push({
          path: '/auth/login',
          query: accountLoginQuery(),
        })
      "
      >返回账号登录</Button
    >
    <Button v-if="!info && !loading" type="link" @click="initialize"
      >重新加载</Button
    >
  </section>
</template>

<style scoped>
.account-form {
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
.code-row {
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
