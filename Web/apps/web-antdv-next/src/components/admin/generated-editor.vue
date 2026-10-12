<script setup lang="ts">
import type { GeneratedApi, GeneratedOption, GeneratedRow, GeneratedSchema } from './generated';

import { computed, onDeactivated, onScopeDispose, ref, shallowRef, useId } from 'vue';

import { Alert, Button, Form, FormItem, Modal, Spin } from 'antdv-next';

import { createGeneratedSession, generatedCancelled, generatedKeys, generatedOptions, generatedRules } from './generated';
import GeneratedField from './generated-field.vue';

const props = defineProps<{ schema: GeneratedSchema; api: GeneratedApi }>();
const emit = defineEmits<{ saved: [] }>();
const session = createGeneratedSession();
const formId = useId();
const open = ref(false);
const editing = ref(false);
const busy = ref(false);
const loading = ref(false);
const uploading = ref(false);
const uploadFields = new Set<string>();
const viewKey = ref(0);
const loaded = ref(false);
function fieldBusy(key: string, value: boolean) { if (value) uploadFields.add(key); else uploadFields.delete(key); uploading.value = uploadFields.size > 0; }
const feedback = ref('');
const values = ref<GeneratedRow>({});
const options = shallowRef<Record<string, GeneratedOption[]>>({});
const fields = computed(() => props.schema.fields.filter((field) => field.editable));
let generation = 0;
function close() {
 generation += 1; viewKey.value += 1; loaded.value = false; uploadFields.clear(); session.clear(); open.value = false; loading.value = false; busy.value = false; uploading.value = false;
 values.value = {}; options.value = {}; feedback.value = '';
}
async function show(row?: GeneratedRow) {
 close(); open.value = true; editing.value = Boolean(row); loading.value = true;
 const current = generation;
 try {
  const [detail, selection] = await session.run((signal) => Promise.all([row ? props.api.detail(generatedKeys(props.schema, row), signal) : Promise.resolve(structuredClone(props.schema.defaults)), generatedOptions(props.schema, props.api, false, signal)]));
  if (current !== generation) return;
  values.value = { ...detail }; options.value = selection; loaded.value = true;
 } catch (cause) { if (!generatedCancelled(cause) && current === generation) feedback.value = '加载失败，请关闭后重试'; }
 finally { if (current === generation) loading.value = false; }
}
async function save() {
 if (!loaded.value || busy.value || loading.value || uploading.value) return;
 feedback.value = generatedRules(props.schema, values.value);
 if (feedback.value) return;
 busy.value = true; const current = generation;
 const snapshot = { ...values.value };
 try {
  await session.run((signal) => editing.value ? props.api.update(snapshot, signal) : props.api.add(snapshot, signal));
  if (current !== generation) return;
  close(); emit('saved');
 } catch (cause) { if (!generatedCancelled(cause) && current === generation) feedback.value = cause instanceof Error ? cause.message : '保存失败，草稿已保留，请重试'; }
 finally { if (current === generation) busy.value = false; }
}
onDeactivated(close); onScopeDispose(close);
defineExpose({ show, close });
</script>

<template>
 <Modal :open="open" :title="`${editing ? '编辑' : '新增'}${schema.title}`" :mask-closable="false" :closable="!busy" destroy-on-hidden :width="780" @cancel="close">
  <Alert v-if="feedback" :title="feedback" type="error" role="alert" class="mb-4" />
  <Spin v-if="open" :key="viewKey" :spinning="loading">
   <Form layout="vertical" @submit.prevent="save">
    <FormItem v-for="field in fields" :key="field.key" :label="field.title" :html-for="`${formId}-${field.key}`" :required="field.required">
     <GeneratedField :id="`${formId}-${field.key}`" v-model="values[field.key]" :field="field" :options="options[field.key]" :api="api" :disabled="loading || busy || (editing && schema.primaryKeys.includes(field.key))" @busy="fieldBusy(field.key, $event)" />
    </FormItem>
   </Form>
  </Spin>
  <template #footer><Button :disabled="busy" @click="close">取消</Button><Button type="primary" :loading="busy" :disabled="!loaded || loading || uploading" @click="save">保存</Button></template>
 </Modal>
</template>
