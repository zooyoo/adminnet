<script setup lang="ts">
import type { CodeGenDirectPlan, CodeGenRow } from '#/api/system/codegen';

import { computed, onDeactivated, onScopeDispose, ref, shallowRef, useId, watch } from 'vue';

import { useUserStore } from '@vben/stores';

import { Alert, Button, Checkbox, message, Modal, Select } from 'antdv-next';

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
const reviewing = ref(false);
const generating = ref(false);
const overwrite = ref(false);
const directPlan = shallowRef<CodeGenDirectPlan>();
const hasExisting = computed(() => directPlan.value?.files.some(file => file.existingSha256 !== null) ?? false);
const canDirect = computed(() => row.value?.generateType?.startsWith('2') ?? false);
const row = shallowRef<CodeGenRow>();
const files = shallowRef<Record<string, string>>({});
const selected = ref<string>();
const fileOptions = computed(() => Object.keys(files.value).map((value) => ({ value, label: value })));
const canZip = computed(() => row.value?.generateType?.startsWith('1') ?? false);
let generation = 0;
function close() {
 generation += 1; session.clear(); open.value = false; busy.value = false; downloading.value = false;
 error.value = ''; row.value = undefined; files.value = {}; selected.value = undefined;
 directPlan.value = undefined; overwrite.value = false; reviewing.value = false; generating.value = false;
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
async function inspectDirect() {
 if (!row.value || !canDirect.value || busy.value || reviewing.value || generating.value) return;
 const current = generation; const id = row.value.id;
 reviewing.value = true; error.value = ''; overwrite.value = false; directPlan.value = undefined;
 try {
  const result = await session.run(signal => codegenApi.inspectDirect(id, signal));
  if (current === generation) directPlan.value = result;
 } catch (cause) { if (current === generation && !generatedCancelled(cause)) error.value = cause instanceof Error ? cause.message : '清单核对失败，请重试'; }
 finally { if (current === generation) reviewing.value = false; }
}
async function generateDirect() {
 if (!row.value || !directPlan.value || reviewing.value || generating.value || (hasExisting.value && !overwrite.value)) return;
 const current = generation; const id = row.value.id; const fingerprint = directPlan.value.fingerprint;
 generating.value = true; error.value = '';
 try {
  await session.run(signal => codegenApi.runDirect(id, fingerprint, overwrite.value, signal));
  if (current !== generation) return;
  message.success('直接生成完成，文件与菜单已保存');
  overwrite.value = false;
  directPlan.value = undefined;
 } catch (cause) { if (current === generation && !generatedCancelled(cause)) error.value = cause instanceof Error ? cause.message : '直接生成失败，请核对目标后重试'; }
 finally { if (current === generation) generating.value = false; }
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
   <pre aria-label="生成文件内容" :aria-busy="busy" class="codegen-source" :class="{ 'with-plan': directPlan }">{{ selected ? files[selected] : busy ? '正在生成预览…' : '请选择生成文件' }}</pre>
   <section v-if="canDirect" aria-label="直接生成清单" class="space-y-3">
    <Button :loading="reviewing" :disabled="busy || generating" @click="inspectDirect">核对生成清单</Button>
    <ul v-if="directPlan" class="direct-files">
     <li v-for="file in directPlan.files" :key="file.path"><strong>{{ file.template }}</strong><span>{{ file.path }}</span><span>{{ file.existingSha256 ? '已有文件，将按已核对摘要覆盖' : '新增文件' }}</span></li>
    </ul>
    <Checkbox v-if="directPlan && hasExisting" v-model:checked="overwrite" :disabled="generating">允许覆盖清单中已核对的现有文件</Checkbox>
    <p v-if="directPlan" class="text-muted-foreground">目标文件或生成配置变化后，需要重新核对清单。清单之外的文件保留。</p>
   </section>
  </div>
  <template #footer>
   <Button :disabled="generating" @click="close">关闭</Button>
   <Button v-if="canZip" type="primary" :loading="downloading" :disabled="busy || downloading" @click="download">下载 ZIP</Button>
   <Button v-if="canDirect" type="primary" :loading="generating" :disabled="busy || reviewing || !directPlan || (hasExisting && !overwrite)" @click="generateDirect">直接生成</Button>
  </template>
 </Modal>
</template>

<style scoped>
.direct-files { max-height: 240px; overflow: auto; padding: 12px; border: 1px solid hsl(var(--border)); border-radius: 6px; }
.direct-files li { display: grid; gap: 4px; margin-bottom: 12px; overflow-wrap: anywhere; }
.codegen-source.with-plan { min-height: 180px; max-height: 28vh; }
.codegen-source { min-height: 360px; max-height: 62vh; overflow: auto; padding: 16px; border: 1px solid hsl(var(--border)); border-radius: 6px; background: hsl(var(--muted)); color: hsl(var(--foreground)); font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.5; white-space: pre; }
</style>
