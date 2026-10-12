<script setup lang="ts">
import type { GeneratedApi, GeneratedField, GeneratedOption } from './generated';

import { computed, ref } from 'vue';

import { Alert, Button, DatePicker, Input, InputNumber, Select, Switch, TreeSelect, Upload } from 'antdv-next';

import NoticeEditor from '#/components/notice-editor/index.vue';

import { createGeneratedSession, generatedCancelled, generatedValue } from './generated';

const props = withDefaults(defineProps<{ id: string; field: GeneratedField; options?: GeneratedOption[]; disabled?: boolean; query?: boolean; api?: GeneratedApi }>(), { options: () => [], disabled: false, query: false, api: undefined });
const emit = defineEmits<{ busy: [value: boolean] }>();
const model = defineModel<unknown>();
const session = createGeneratedSession();
const busy = ref(false);
const error = ref('');
const text = computed({ get: () => String(model.value ?? ''), set: (value: string) => { model.value = value; } });
const numeric = computed({ get: () => typeof model.value === 'number' ? model.value : undefined, set: (value: null | number | string) => { model.value = generatedValue(props.field, value); } });
const selected = computed({ get: () => typeof model.value === 'number' || typeof model.value === 'string' ? model.value : undefined, set: (value: number | string | undefined) => { model.value = generatedValue(props.field, value); } });
const checked = computed({ get: () => Boolean(model.value), set: (value: boolean | number | string) => { model.value = Boolean(value); } });
const nullFilter = computed({ get: () => model.value === undefined ? undefined : String(model.value), set: (value: string | undefined) => { model.value = value === undefined ? undefined : value === 'true'; } });
const range = computed({ get: () => Array.isArray(model.value) && model.value.length === 2 ? model.value as [string, string] : undefined, set: (value: [string, string] | null) => { model.value = value ?? undefined; } });
function editorBusy(value: boolean) { busy.value = value; emit('busy', value); }
async function upload(file: File) {
 if (props.disabled || busy.value || !props.api?.upload) return false;
 editorBusy(true); error.value = '';
 try {
  const result = await session.run((signal) => props.api!.upload!(props.field.key, file, signal));
  if (!result.url) throw new Error('上传未返回文件地址');
  model.value = result.url;
 } catch (cause) { if (!generatedCancelled(cause)) error.value = '上传失败，请重试'; }
 finally { editorBusy(false); }
 return false;
}
import { onScopeDispose } from 'vue';
onScopeDispose(() => session.clear());
</script>

<template>
 <div class="generated-field">
  <Select v-if="query && field.queryType === 'isNotNull'" :id="id" v-model:value="nullFilter" :options="[{ label: '非空', value: 'true' }, { label: '为空', value: 'false' }]" :disabled="disabled" allow-clear class="w-full" />
  <DatePicker.RangePicker v-else-if="query && field.queryType === '~' && field.netType.replace('?', '') === 'DateTime'" :id="id" v-model:value="range" value-format="YYYY-MM-DD HH:mm:ss" show-time :disabled="disabled" class="w-full" />
  <TreeSelect v-else-if="field.effectType === 'ApiTreeSelector'" :id="id" v-model:value="selected" :tree-data="options" :disabled="disabled" tree-default-expand-all allow-clear show-search tree-node-filter-prop="label" class="w-full" />
  <Select v-else-if="['DictSelector', 'ConstSelector', 'EnumSelector', 'ForeignKey'].includes(field.effectType)" :id="id" v-model:value="selected" :options="options" :disabled="disabled" allow-clear show-search option-filter-prop="label" class="w-full" />
  <InputNumber v-else-if="field.effectType === 'InputNumber'" :id="id" v-model:value="numeric" :disabled="disabled" class="w-full" />
  <DatePicker v-else-if="field.effectType === 'DatePicker'" :id="id" v-model:value="selected" value-format="YYYY-MM-DD HH:mm:ss" show-time :disabled="disabled" class="w-full" />
  <Switch v-else-if="field.effectType === 'Switch'" :id="id" v-model:checked="checked" :disabled="disabled" :aria-label="field.title" />
  <Input.TextArea v-else-if="field.effectType === 'InputTextArea'" :id="id" v-model:value="text" :disabled="disabled" :maxlength="field.maxLength > 0 ? field.maxLength : undefined" :rows="3" />
  <NoticeEditor v-else-if="field.effectType === 'Editor' && !query" :id="id" v-model="text" :disabled="disabled" @busy="editorBusy" />
  <div v-else-if="['Upload', 'Upload_SingleFile'].includes(field.effectType) && !query" class="space-y-2">
   <Input :id="id" v-model:value="text" :disabled="disabled" placeholder="文件地址" />
   <Upload :show-upload-list="false" :before-upload="upload" :disabled="disabled || busy"><Button :loading="busy" :disabled="disabled || busy">上传{{ field.effectType === 'Upload' ? '图片' : '文件' }}</Button></Upload>
  </div>
  <Input v-else :id="id" v-model:value="text" :disabled="disabled" :maxlength="field.maxLength > 0 ? field.maxLength : undefined" allow-clear />
  <Alert v-if="error" :title="error" type="error" role="alert" class="mt-2" />
 </div>
</template>
