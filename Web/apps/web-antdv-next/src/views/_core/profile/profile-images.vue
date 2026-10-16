<script setup lang="ts">
import type { ProfileRecord } from '#/api/system/profile';

import { onScopeDispose, ref, watch } from 'vue';

import { useAccess } from '@vben/access';
import { VCropper } from '@vben/common-ui';

import { Alert, Button, Image, Input, InputNumber, Modal, Upload } from 'antdv-next';
import SignaturePad from 'signature_pad';

import { requestClient } from '#/api/request';
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
const signatureUrl = ref('');
watch(
	() => props.profile.signature,
	async (signature, _, onCleanup) => {
		const request = new AbortController();
		let current = true;
		onCleanup(() => {
			current = false;
			request.abort();
			if (signatureUrl.value) URL.revokeObjectURL(signatureUrl.value);
			signatureUrl.value = '';
		});
		if (!signature) return;
		try {
			const blob = await requestClient.get<Blob>('/api/sysFile/ownSignature', { responseType: 'blob', signal: request.signal });
			if (current) signatureUrl.value = URL.createObjectURL(blob);
		} catch {
			/* 由请求层显示错误。 */
		}
	},
	{ immediate: true }
);
let pad: SignaturePad | undefined;
let alive = true;

function releaseCrop() {
	if (cropUrl.value) URL.revokeObjectURL(cropUrl.value);
	cropUrl.value = '';
}
watch(cropOpen, (open) => {
	if (!open) releaseCrop();
});
watch([color, width], ([penColor, minWidth]) => {
	if (pad) {
		pad.penColor = penColor;
		pad.minWidth = minWidth;
		pad.maxWidth = minWidth + 1.5;
	}
});
onScopeDispose(() => {
	alive = false;
	controller.abort();
	pad?.off();
	releaseCrop();
});

async function editCurrentAvatar() {
	if (props.disabled || busy.value || !hasAccessByCodes(['sysFile:uploadAvatar'])) return;
	const currentUrl = siteLogoUrl(props.profile.avatar ?? undefined);
	if (!currentUrl) return;
	const version = sessionBoundary.version;
	busy.value = true;
	error.value = '';
	try {
		const response = await fetch(currentUrl, { signal: controller.signal });
		if (!response.ok) throw new Error('当前头像加载失败，请选择图片');
		const blob = await response.blob();
		if (!alive || version !== sessionBoundary.version) return;
		releaseCrop();
		cropUrl.value = URL.createObjectURL(blob);
		cropOpen.value = true;
	} catch (cause) {
		if (alive && version === sessionBoundary.version && !controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '当前头像加载失败';
	} finally {
		busy.value = false;
	}
}

function selectAvatar(file: File) {
	if (props.disabled || busy.value) return false;
	releaseCrop();
	error.value = '';
	if (!file.type.startsWith('image/')) {
		error.value = '请选择图片';
		return false;
	}
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
	if (strokes?.length) {
		strokes.pop();
		pad?.fromData(strokes);
	}
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
		<button v-if="hasAccessByCodes(['sysFile:uploadAvatar'])" type="button" class="profile-avatar-edit" aria-label="裁剪当前头像" :disabled="disabled || busy" @click="editCurrentAvatar"><Image :src="siteLogoUrl(profile.avatar ?? undefined)" :width="80" :height="80" alt="个人头像" :preview="false" /><span class="profile-avatar-edit-hint" aria-hidden="true">更换头像</span></button><Image v-else :src="siteLogoUrl(profile.avatar ?? undefined)" :width="80" :height="80" alt="个人头像" />
		<Upload v-if="hasAccessByCodes(['sysFile:uploadAvatar'])" :before-upload="selectAvatar" :show-upload-list="false" accept="image/*">
			<Button :disabled="disabled || busy">更换头像</Button>
		</Upload>
		<Image v-if="signatureUrl" :src="signatureUrl" :width="160" :height="80" alt="电子签名" :styles="{ image: { objectFit: 'contain', background: '#fff' } }" />
		<template v-if="hasAccessByCodes(['sysFile:uploadSignature'])">
			<Button
				:disabled="disabled || busy"
				@click="
					error = '';
					signOpen = true;
				"
				>电子签名</Button
			>
			<Upload :before-upload="(file) => upload(file, 'signature')" :show-upload-list="false" accept=".png">
				<Button :disabled="disabled || busy">上传手写签名</Button>
			</Upload>
		</template>
	</div>
	<Modal
		v-model:open="cropOpen"
		title="更换头像"
		:width="600"
		:confirm-loading="busy"
		:closable="!busy"
		:mask-closable="!busy"
		:keyboard="!busy"
		:cancel-button-props="{ disabled: busy }"
		@ok="saveAvatar"
	>
		<Alert v-if="error" class="mb-3" :title="error" type="error" show-icon />
		<VCropper v-if="cropUrl" ref="cropper" :img="cropUrl" aspect-ratio="1:1" :width="540" :height="350" />
	</Modal>
	<Modal
		v-model:open="signOpen"
		title="电子签名"
		:width="620"
		:confirm-loading="busy"
		:closable="!busy"
		:mask-closable="!busy"
		:keyboard="!busy"
		:cancel-button-props="{ disabled: busy }"
		:after-open-change="initializePad"
		@ok="saveSignature"
	>
		<Alert v-if="error" class="mb-3" :title="error" type="error" show-icon />
		<canvas ref="canvas" aria-label="签名画布" class="max-w-full border bg-white" style="width: 560px; height: 220px; touch-action: none" />
		<div class="mt-3 flex items-center gap-3">
			<label for="signature-color">画笔颜色</label><Input id="signature-color" v-model:value="color" type="color" class="!w-16" :disabled="busy" /> <label for="signature-width">画笔粗细</label
			><InputNumber id="signature-width" v-model:value="width" :min="0.5" :max="2.5" :step="0.1" :disabled="busy" /> <Button :disabled="busy" @click="undo">撤销</Button
			><Button :disabled="busy" @click="pad?.clear()">清屏</Button>
		</div>
	</Modal>
</template>

<style scoped>
.profile-avatar-edit { position: relative; display: block; width: 80px; height: 80px; padding: 0; overflow: hidden; border: 0; border-radius: 50%; cursor: pointer; }
.profile-avatar-edit-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgb(0 0 0 / 45%); color: #fff; opacity: 0; pointer-events: none; }
.profile-avatar-edit:hover .profile-avatar-edit-hint, .profile-avatar-edit:focus-visible .profile-avatar-edit-hint { opacity: 1; }
.profile-avatar-edit:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.profile-avatar-edit:disabled { cursor: not-allowed; }
</style>
