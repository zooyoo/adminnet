<script lang="ts" setup>
import type { NotificationItem } from "@vben/layouts";

import type { Notice } from "#/api/system/notice";

import { computed, onScopeDispose, provide, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { AuthenticationLoginExpiredModal } from "@vben/common-ui";
import { useWatermark } from "@vben/hooks";
import { BasicLayout, UserDropdown } from "@vben/layouts";
import { preferences, usePreferences } from "@vben/preferences";
import { useAccessStore, useUserStore } from "@vben/stores";

import { Alert, Button, Drawer, Modal, notification } from "antdv-next";

import { NoticeInbox } from "#/api/notice-inbox";
import { onlineSession, onlineStatus } from "#/api/realtime";
import { sessionBoundary } from "#/api/session";
import { setNoticeRead, unreadNotices } from "#/api/system/notice";
import NoticeContent from "#/components/notice-content/index.vue";
import { noticePlainText } from "#/components/notice-content/notice-html";
import { noticeReadKey } from "#/components/notice-content/notice-read";
import { $t } from "#/locales";
import { useAuthStore } from "#/store";
import LoginForm from "#/views/_core/authentication/login.vue";
import ReceivedNotices from "#/views/home/notice/index.vue";

import NoticePopover from "./components/notice-popover.vue";
import OnlineUsers from "./components/online-users.vue";
import SessionLock from "./components/session-lock.vue";
import TenantSwitch from "./components/tenant-switch.vue";

const [noticeApi, NoticeContext] = notification.useNotification();
const notifications = ref<NotificationItem[]>([]);
const noticeError = ref("");
const noticeLoading = ref(false);
const noticeReading = ref(false);
const receivedOpen = ref(false);
const noticeDetail = ref<NotificationItem>();
const noticeDetailOpen = computed({
  get: () => noticeDetail.value !== undefined,
  set: (open) => {
    if (!open) noticeDetail.value = undefined;
  },
});

const router = useRouter();
const userStore = useUserStore();
const authStore = useAuthStore();
const accessStore = useAccessStore();
watch(
  () => accessStore.isLockScreen,
  (locked) => {
    if (!locked) return;
    accessStore.lockScreenPassword = undefined;
    receivedOpen.value = false;
    noticeDetailOpen.value = false;
  },
  { immediate: true },
);
const { destroyWatermark, updateWatermark } = useWatermark();
const { isDark } = usePreferences();
const managedWatermark = computed(() =>
  String(userStore.userInfo?.watermarkText ?? ""),
);
provide("vben-managed-watermark", managedWatermark);

const menus = computed(() => [
  {
    handler: () => {
      router.push({ name: "Profile" });
    },
    icon: "lucide:user",
    text: $t("page.auth.profile"),
  },
]);

const avatar = computed(() => {
  return userStore.userInfo?.avatar ?? preferences.app.defaultAvatar;
});

async function handleLogout() {
  await authStore.logout(false);
}

function noticeItem(notice: Notice, isRead = false): NotificationItem {
  return {
    ...notice,
    id: notice.id!,
    avatar: avatar.value,
    date: String(notice.publicTime ?? notice.createTime ?? ""),
    isRead,
    message: noticePlainText(notice.content ?? ""),
    content: notice.content,
    title: String(notice.title ?? "通知"),
  };
}

const inbox = new NoticeInbox({
  load: unreadNotices,
  read: setNoticeRead,
  update: (items) => {
    notifications.value = items.map((notice) => noticeItem(notice));
  },
  error: (error) => {
    noticeError.value = error;
  },
  version: () => sessionBoundary.version,
  loading: (loading) => {
    noticeLoading.value = loading;
  },
});
provide(noticeReadKey, () => {
  void inbox.refresh();
});

async function markRead(id: number | string) {
  await inbox.markRead(id);
}

async function handleMakeAll() {
  if (noticeReading.value) return;
  const version = sessionBoundary.version;
  noticeReading.value = true;
  try {
    const results = await inbox.markAllRead();
    if (
      version === sessionBoundary.version &&
      results.some((result) => !result)
    )
      noticeError.value = "部分通知未能标记为已读，请重试";
  } finally {
    if (version === sessionBoundary.version) noticeReading.value = false;
  }
}

const viewAll = () => {
  receivedOpen.value = true;
};

const handleClick = (item: NotificationItem) => {
  noticeDetail.value = item;
  void markRead(item.id);
};

const notifiedIds = new Set<string>();
const nativeNotices = new Set<Notification>();
const nativeNoticeTimers = new Map<
  Notification,
  ReturnType<typeof setTimeout>
>();
const nativeNoticeIcon = new URL(
  `${import.meta.env.BASE_URL}logo.png`,
  window.location.origin,
).href;
function forgetNativeNotice(notice: Notification) {
  const timer = nativeNoticeTimers.get(notice);
  if (timer !== undefined) clearTimeout(timer);
  nativeNoticeTimers.delete(notice);
  nativeNotices.delete(notice);
}
function closeNativeNotice(notice: Notification) {
  forgetNativeNotice(notice);
  notice.close();
}
function closeNativeNotices() {
  for (const notice of [...nativeNotices]) closeNativeNotice(notice);
}
function resetNotificationEffects() {
  notifiedIds.clear();
  noticeApi.destroy();
  closeNativeNotices();
}
function clearNativeWhenVisible() {
  if (document.visibilityState === "visible") closeNativeNotices();
}
document.addEventListener("visibilitychange", clearNativeWhenVisible);
const disposeNotice = onlineSession.subscribe("PublicNotice", (payload) => {
  void inbox.refresh();
  if (
    !userStore.userInfo ||
    !accessStore.accessToken ||
    !payload ||
    typeof payload !== "object" ||
    !("id" in payload)
  )
    return;
  const notice = payload as Notice;
  if (notice.id === undefined || notice.id === null) return;
  const id = String(notice.id);
  if (notifiedIds.has(id)) return;
  notifiedIds.add(id);
  const item = noticeItem(notice);
  const version = sessionBoundary.version;
  const key = "notice-" + id;
  let nativePopup: Notification | undefined;
  const open = () => {
    if (version !== sessionBoundary.version) return;
    handleClick(item);
    noticeApi.destroy(key);
    if (nativePopup && nativeNotices.has(nativePopup))
      closeNativeNotice(nativePopup);
  };
  noticeApi.info({
    key,
    title: "新消息：" + item.title,
    description: item.message,
    duration: 4.5,
    onClick: open,
  });
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const popup = new Notification(item.title, {
        body: item.message,
        tag: key,
        icon: nativeNoticeIcon,
      });
      nativeNotices.add(popup);
      nativePopup = popup;
      nativeNoticeTimers.set(
        popup,
        setTimeout(() => closeNativeNotice(popup), 4500),
      );
      popup.onclick = () => {
        window.focus();
        open();
        if (nativeNotices.has(popup)) closeNativeNotice(popup);
      };
      popup.onclose = () => forgetNativeNotice(popup);
    } catch {
      /* 浏览器 Native 通知不可用时，应用 toast 仍可点击读取。 */
    }
  }
});

watch(
  () => [
    userStore.userInfo?.id,
    userStore.userInfo?.currentTenantId,
    Boolean(accessStore.accessToken),
  ],
  () => {
    inbox.reset();
    resetNotificationEffects();
    noticeDetail.value = undefined;
    receivedOpen.value = false;
    noticeReading.value = false;
    if (accessStore.accessToken && userStore.userInfo) void inbox.refresh();
  },
  { immediate: true },
);
watch(onlineStatus, (status) => {
  if (status === "connected") void inbox.refresh();
});
onScopeDispose(() => {
  disposeNotice();
  resetNotificationEffects();
  document.removeEventListener("visibilitychange", clearNativeWhenVisible);
  inbox.reset();
});

watch(
  () => ({
    content: managedWatermark.value,
    isDark: isDark.value,
  }),
  async ({ content, isDark: isDarkValue }) => {
    if (content) {
      const watermarkColor = isDarkValue
        ? "rgba(255, 255, 255, 0.12)"
        : "rgba(0, 0, 0, 0.12)";

      await updateWatermark({
        advancedStyle: {
          colorStops: [
            {
              color: watermarkColor,
              offset: 0,
            },
            {
              color: watermarkColor,
              offset: 1,
            },
          ],
          type: "linear",
        },
        content,
      });
    } else {
      destroyWatermark();
    }
  },
  {
    immediate: true,
  },
);
</script>

<template>
  <NoticeContext />
  <BasicLayout
    :avatar
    :text="userStore.userInfo?.realName"
    :lock-screen-handler="authStore.lockScreen"
    :inert="accessStore.isLockScreen"
    :style="{ visibility: accessStore.isLockScreen ? 'hidden' : undefined }"
    @clear-preferences-and-logout="handleLogout"
    @logout="handleLogout"
  >
    <template #user-dropdown>
      <UserDropdown
        :avatar
        :menus
        :text="userStore.userInfo?.realName"
        :description="userStore.userInfo?.account"
        :lock-screen-handler="authStore.lockScreen"
        @clear-preferences-and-logout="handleLogout"
        @logout="handleLogout"
      />
    </template>
    <template #notification>
      <OnlineUsers />
      <TenantSwitch v-if="userStore.userInfo?.accountType === 999" />
      <NoticePopover
        :items="notifications"
        :error="noticeError"
        :loading="noticeLoading"
        :reading="noticeReading"
        @refresh="inbox.refresh()"
        @read-all="handleMakeAll"
        @detail="handleClick"
        @view-all="viewAll"
      />
    </template>
    <template #extra>
      <Alert v-if="noticeError" :message="noticeError" type="error" show-icon>
        <template #action
          ><Button size="small" @click="inbox.refresh()"
            >重试通知</Button
          ></template
        >
      </Alert>
      <AuthenticationLoginExpiredModal
        v-model:open="accessStore.loginExpired"
        :avatar
      >
        <LoginForm />
      </AuthenticationLoginExpiredModal>
    </template>
  </BasicLayout>
  <Drawer
    v-model:open="receivedOpen"
    title="通知中心"
    :size="preferences.app.isMobile ? 360 : 960"
    :styles="{ wrapper: { maxWidth: '100vw' } }"
  >
    <ReceivedNotices v-if="receivedOpen" />
  </Drawer>
  <Modal
    v-model:open="noticeDetailOpen"
    title="通知详情"
    :footer="null"
    centered
    :styles="{ body: { maxHeight: 'calc(100dvh - 160px)', overflowY: 'auto' } }"
  >
    <template v-if="noticeDetail">
      <h3>{{ noticeDetail.title }}</h3>
      <NoticeContent :content="String(noticeDetail.content ?? '')" />
      <Button v-if="noticeError" @click="markRead(noticeDetail.id)"
        >重试已读</Button
      >
    </template>
  </Modal>
  <SessionLock v-if="accessStore.isLockScreen" />
</template>

<style scoped>
.notice-detail {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
}
</style>
