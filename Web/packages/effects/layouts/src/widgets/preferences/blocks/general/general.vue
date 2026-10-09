<script setup lang="ts">
import type { ComputedRef } from 'vue';

import type { LanguageOption } from '@vben/constants';

import { inject, onMounted, onUnmounted, ref, unref } from 'vue';

import { onSupportLanguagesChange } from '@vben/constants';
import { $t } from '@vben/locales';
import { useTimezoneStore } from '@vben/stores';

import InputItem from '../input-item.vue';
import SelectItem from '../select-item.vue';
import SwitchItem from '../switch-item.vue';

defineOptions({
  name: 'PreferenceGeneralConfig',
});

const appLocale = defineModel<string | undefined>('appLocale', {
  default: undefined,
});
const appTimezone = defineModel<string | undefined>('appTimezone', {
  default: undefined,
});
const appDynamicTitle = defineModel<boolean>('appDynamicTitle');
const appWatermark = defineModel<boolean>('appWatermark');
const appWatermarkContent = defineModel<string | undefined>(
  'appWatermarkContent',
  {
    default: undefined,
  },
);
const appEnableCheckUpdates = defineModel<boolean>('appEnableCheckUpdates');
const appEnableCopyPreferences = defineModel<boolean>(
  'appEnableCopyPreferences',
);
const timezoneStore = useTimezoneStore();
// 应用提供受管理的水印时，仅展示服务端值，不将账号文字写入共享偏好。
const managedWatermark = inject<ComputedRef<string> | undefined>('vben-managed-watermark', undefined);

const languageList = ref<LanguageOption[]>([]);
const unsubscribe = onSupportLanguagesChange((langs) => {
  languageList.value = [...langs];
});
onUnmounted(unsubscribe);

const timezoneOptionsRef = ref<
  {
    label: string;
    value: string;
  }[]
>([]);

onMounted(async () => {
  timezoneOptionsRef.value = await timezoneStore.getTimezoneOptions();
  // 获取当前时区，例如：Asia/Shanghai
  const timezoneValue = unref(timezoneStore.timezone);
  if (timezoneValue) {
    appTimezone.value = timezoneValue;
  }
});
</script>

<template>
  <SelectItem v-model="appLocale" :items="languageList">
    {{ $t('preferences.language') }}
  </SelectItem>
  <SelectItem v-model="appTimezone" :items="timezoneOptionsRef">
    {{ $t('preferences.timezone') }}
  </SelectItem>
  <SwitchItem v-model="appDynamicTitle">
    {{ $t('preferences.dynamicTitle') }}
  </SwitchItem>
  <SwitchItem
    v-if="managedWatermark === undefined"
    v-model="appWatermark"
    @update:model-value="
      (val) => {
        if (!val) appWatermarkContent = '';
      }
    "
  >
    {{ $t('preferences.watermark') }}
  </SwitchItem>
  <InputItem
    v-if="managedWatermark === undefined && appWatermark"
    v-model="appWatermarkContent"
    :placeholder="$t('preferences.watermarkContent')"
  >
    {{ $t('preferences.watermarkContent') }}
  </InputItem>
  <template v-if="managedWatermark !== undefined">
    <SwitchItem :model-value="!!managedWatermark" disabled>{{ $t('preferences.watermark') }}</SwitchItem>
    <InputItem :model-value="managedWatermark" disabled>{{ $t('preferences.watermarkContent') }}</InputItem>
  </template>
  <SwitchItem v-model="appEnableCheckUpdates">
    {{ $t('preferences.checkUpdates') }}
  </SwitchItem>
  <SwitchItem v-model="appEnableCopyPreferences">
    {{ $t('preferences.enableCopyPreferences') }}
  </SwitchItem>
</template>
