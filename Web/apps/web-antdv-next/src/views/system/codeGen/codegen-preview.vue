<script setup lang="ts">
import type { CodeGenRow } from '#/api/system/codegen';

import { computed, onDeactivated, onScopeDispose, ref, shallowRef, useId, watch } from 'vue';

import { useUserStore } from '@vben/stores';

import { Alert, Button, message, Modal, Select } from 'antdv-next';

import { decodeFileResponse, downloadFile } from '#/api/file-response';
import { requestClient } from '#/api/request';
import { codegenApi } from '#/api/system/codegen';
import { createGeneratedSession, generatedCancelled } from '#/components/admin/generated';

const user = useUserStore();
const session = createGeneratedSession();
const controlId = useId();
const open = ref(false);
const busy = ref(false);
const downloading = ref(false);
const error = ref('');
const row = shallowRef<CodeGenRow>();
const files = shallowRef<Record<string, string>>({});
const selected = ref<string>();
const fileOptions = computed(() => Object.keys(files.value).map((value) => ({ value, label: value })));
const canZip = computed(() => row.value?.generateType?.startsWith('1') ?? false);
let generation = 0;
function close() {
 generation += 1; session.clear(); open.value = false; busy.value = false; downloading.value = false;
 error.value = ''; row.value = undefined; files.value = {}; selected.value = undefined;
}
async function load() {
 if (!row.value || busy.value) return;
 const current = generation; const id = row.value.id;
 busy.value = true; error.value = '';
 try {
  const result = await session.run((signal) => codegenApi.preview(id, signal));
  if (current !== generation) return;
  files.value = result;
  selected.value = Object.keys(result)[0];
  if (!selected.value) error.value = '没有可预览的生成文件，请检查配置';
 } catch (cause) { if (current === generation && !generatedCancelled(cause)) error.value = cause instanceof Error ? cause.message : '预览失败，请重试'; }
 finally { if (current === generation) busy.value = false; }
}
async function show(value: CodeGenRow) { close(); row.value = value; open.value = true; await load(); }
async function download() {
 if (!row.value || !canZip.value || busy.value || downloading.value) return;
 const current = generation; const id = row.value.id; const name = row.value.tableName ?? 'generated';
 downloading.value = true; error.value = '';
 try {
  const response = await session.run(async (signal) => {
   const result = await codegenApi.zip(id, signal);
   if (!/^\/codeGen\/[\w.-]+\.zip$/i.test(result.url)) throw new Error('生成文件下载地址无效');
   return requestClient.instance.get<ArrayBuffer>(result.url, { signal, responseType: 'arraybuffer', silentError: true });
  });
  const result = await decodeFileResponse(response, `${name}.zip`);
  if (current !== generation) return;
  if (result.kind !== 'file') throw new Error(result.message);
  downloadFile(result.file); message.success('ZIP 已生成并下载');
 } catch (cause) { if (current === generation && !generatedCancelled(cause)) error.value = cause instanceof Error ? cause.message : '生成失败，请重试'; }
 finally { if (current === generation) downloading.value = false; }
}
watch(() => [user.userInfo?.userId, user.userInfo?.tenantId, user.userInfo?.currentTenantId].join(':'), close, { flush: 'sync' });
onDeactivated(close); onScopeDispose(close);
defineExpose({ show, close });
</script>

<template>
 <Modal :open="open" :title="`代码预览 · ${row?.busName ?? ''}`" width="92vw" destroy-on-hidden :mask-closable="false" @cancel="close">
  <div class="codegen-preview space-y-3">
   <Alert v-if="error" :title="error" type="error" role="alert"><template #action><Button :loading="busy" @click="load">重新预览</Button></template></Alert>
   <label :for="controlId">生成文件</label>
   <Select :id="controlId" v-model:value="selected" :options="fileOptions" :disabled="busy" class="w-full" />
   <pre aria-label="生成文件内容" :aria-busy="busy" class="codegen-source">{{ selected ? files[selected] : busy ? '正在生成预览…' : '请选择生成文件' }}</pre>
   <Alert v-if="!canZip" title="当前配置为直接生成；如需下载 ZIP，请在生成配置中选择 ZIP 生成类型并保存。" type="info" />
  </div>
  <template #footer><Button @click="close">关闭</Button><Button type="primary" :loading="downloading" :disabled="!canZip || busy || downloading" @click="download">下载 ZIP</Button></template>
 </Modal>
</template>

<style scoped>
.codegen-source { min-height: 360px; max-height: 62vh; overflow: auto; padding: 16px; border: 1px solid hsl(var(--border)); border-radius: 6px; background: hsl(var(--muted)); color: hsl(var(--foreground)); font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.5; white-space: pre; }
</style>
