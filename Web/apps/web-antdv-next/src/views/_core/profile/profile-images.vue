<script setup lang="ts">
import type { ProfileRecord } from '#/api/system/profile';

import { onScopeDispose, ref, watch } from 'vue';

import { useAccess } from '@vben/access';
import { VCropper } from '@vben/common-ui';

import { Alert, Button, Image, Input, InputNumber, Modal, Upload } from 'antdv-next';
import SignaturePad from 'signature_pad';

import { sessionBoundary } from '#/api/session';
import { getProfile, saveProfile, uploadProfileImage } from '#/api/system/profile';
import { useAuthStore } from '#/store';
import { siteLogoUrl } from '#/utils/site-logo';

const props = withDefaults(defineProps<{ profile: ProfileRecord; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ busy: [value: boolean]; updated: [kind: 'avatar' | 'signature', value: null | string] }>();
const auth = useAuthStore();
const { hasAccessByCodes } = useAccess();
const cropper = ref<InstanceType<typeof VCropper>>();
const cropOpen = ref(false);
const cropUrl = ref('');
const signOpen = ref(false);
const canvas = ref<HTMLCanvasElement>();
const color = ref('#000000');
const width = ref(1);
const busy = ref(false);
watch(busy, (value) => emit('busy', value));
const error = ref('');
const controller = new AbortController();
let pad: SignaturePad | undefined;
let alive = true;

function releaseCrop() {
	if (cropUrl.value) URL.revokeObjectURL(cropUrl.value);
	cropUrl.value = '';
}
watch(cropOpen, (open) => { if (!open) releaseCrop(); });
watch([color, width], ([penColor, minWidth]) => {
	if (pad) { pad.penColor = penColor; pad.minWidth = minWidth; pad.maxWidth = minWidth + 1.5; }
});
onScopeDispose(() => { alive = false; controller.abort(); pad?.off(); releaseCrop(); });

function selectAvatar(file: File) {
	if (props.disabled || busy.value) return false;
	releaseCrop();
	error.value = '';
	if (!file.type.startsWith('image/')) { error.value = '请选择图片'; return false; }
	cropUrl.value = URL.createObjectURL(file);
	cropOpen.value = true;
	return false;
}
async function upload(file: File, kind: 'avatar' | 'signature') {
	if (props.disabled || busy.value) return false;
	const version = sessionBoundary.version;
	busy.value = true;
	error.value = '';
	try {
		const result = await uploadProfileImage(file, kind, controller.signal);
		if (!alive || version !== sessionBoundary.version) return false;
		await auth.fetchUserInfo();
		if (!alive || version !== sessionBoundary.version) return false;
		emit('updated', kind, result.url ?? null);
		cropOpen.value = signOpen.value = false;
	} catch (cause) {
		if (alive && version === sessionBoundary.version) error.value = cause instanceof Error ? cause.message : '图片上传失败';
	} finally {
		busy.value = false;
	}
	return false;
}
async function saveAvatar() {
	try {
		const blob = await cropper.value?.getCropImage('image/png', 0.92, 'blob', 256, 256);
		if (!(blob instanceof Blob)) throw new Error('图片尚未加载完成');
		await upload(new File([blob], 'avatar.png', { type: 'image/png' }), 'avatar');
	} catch (cause) {
		error.value = cause instanceof Error ? cause.message : '头像裁剪失败';
	}
}
function initializePad(open: boolean) {
	pad?.off();
	pad = undefined;
	if (!open || !canvas.value) return;
	const ratio = Math.max(window.devicePixelRatio || 1, 1);
	canvas.value.width = 560 * ratio;
	canvas.value.height = 220 * ratio;
	canvas.value.getContext('2d')?.scale(ratio, ratio);
	pad = new SignaturePad(canvas.value, { penColor: color.value, minWidth: width.value, maxWidth: width.value + 1.5 });
}
function undo() {
	const strokes = pad?.toData();
	if (strokes?.length) { strokes.pop(); pad?.fromData(strokes); }
}
async function saveSignature() {
	if (!pad || !canvas.value || busy.value) return;
	if (pad.isEmpty()) {
		const version = sessionBoundary.version;
		busy.value = true;
		error.value = '';
		try {
			const current = await getProfile(controller.signal);
			if (!alive || version !== sessionBoundary.version) return;
			await saveProfile({ ...current, signature: null }, controller.signal);
			if (!alive || version !== sessionBoundary.version) return;
			await auth.fetchUserInfo();
			if (!alive || version !== sessionBoundary.version) return;
			emit('updated', 'signature', null);
			signOpen.value = false;
		} catch (cause) {
			if (alive) error.value = cause instanceof Error ? cause.message : '签名清除失败';
		} finally {
			busy.value = false;
		}
		return;
	}
	const blob = await new Promise<Blob | null>((resolve) => canvas.value!.toBlob(resolve, 'image/png'));
	if (blob && alive) await upload(new File([blob], 'signature.png', { type: 'image/png' }), 'signature');
}
</script>

<template>
	<Alert v-if="error && !cropOpen && !signOpen" class="mb-4" :title="error" type="error" show-icon />
	<div class="flex items-center gap-4">
		<Image :src="siteLogoUrl(profile.avatar ?? undefined)" :width="80" :height="80" alt="个人头像" />
		<Upload v-if="hasAccessByCodes(['sysFile:uploadAvatar'])" :before-upload="selectAvatar" :show-upload-list="false" accept="image/*">
			<Button :disabled="disabled || busy">更换头像</Button>
		</Upload>
		<Image v-if="profile.signature" :src="siteLogoUrl(profile.signature)" :width="160" :height="80" alt="电子签名" :styles="{ image: { objectFit: 'contain', background: '#fff' } }" />
		<template v-if="hasAccessByCodes(['sysFile:uploadSignature'])">
			<Button :disabled="disabled || busy" @click="error = ''; signOpen = true">电子签名</Button>
			<Upload :before-upload="(file) => upload(file, 'signature')" :show-upload-list="false" accept=".png">
				<Button :disabled="disabled || busy">上传手写签名</Button>
			</Upload>
		</template>
	</div>
	<Modal v-model:open="cropOpen" title="更换头像" :width="600" :confirm-loading="busy" :closable="!busy" :mask-closable="!busy" :keyboard="!busy" :cancel-button-props="{ disabled: busy }" @ok="saveAvatar">
		<Alert v-if="error" class="mb-3" :title="error" type="error" show-icon />
		<VCropper v-if="cropUrl" ref="cropper" :img="cropUrl" aspect-ratio="1:1" :width="540" :height="350" />
	</Modal>
	<Modal v-model:open="signOpen" title="电子签名" :width="620" :confirm-loading="busy" :closable="!busy" :mask-closable="!busy" :keyboard="!busy" :cancel-button-props="{ disabled: busy }" :after-open-change="initializePad" @ok="saveSignature">
		<Alert v-if="error" class="mb-3" :title="error" type="error" show-icon />
		<canvas ref="canvas" aria-label="签名画布" class="max-w-full border bg-white" style="width: 560px; height: 220px; touch-action: none" />
		<div class="mt-3 flex items-center gap-3">
			<label for="signature-color">画笔颜色</label><Input id="signature-color" v-model:value="color" type="color" class="!w-16" :disabled="busy" />
			<label for="signature-width">画笔粗细</label><InputNumber id="signature-width" v-model:value="width" :min="0.5" :max="2.5" :step="0.1" :disabled="busy" />
			<Button :disabled="busy" @click="undo">撤销</Button><Button :disabled="busy" @click="pad?.clear()">清屏</Button>
		</div>
	</Modal>
</template>
