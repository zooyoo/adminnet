<script setup lang="ts">
import { Button, Modal } from 'antdv-next';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
	<Modal :open="open" title="开放接口说明" :width="760" destroy-on-hidden @cancel="emit('close')">
		<div class="open-access-help">
			<p>开放接口使用绑定用户的权限访问。接口启用签名验证后，请在请求头中传递以下字段。</p>
			<table>
				<caption>
					请求头字段
				</caption>
				<thead>
					<tr>
						<th>名称</th>
						<th>说明</th>
						<th>固定示例</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>accessKey</td>
						<td>身份标识</td>
						<td>YOUR_ACCESS_KEY</td>
					</tr>
					<tr>
						<td>timestamp</td>
						<td>Unix 时间戳，单位为秒</td>
						<td>1700000000</td>
					</tr>
					<tr>
						<td>nonce</td>
						<td>随机数</td>
						<td>123456</td>
					</tr>
					<tr>
						<td>sign</td>
						<td>Base64 编码的 HMAC-SHA256 签名</td>
						<td>YOUR_SIGNATURE</td>
					</tr>
				</tbody>
			</table>
			<p>签名原文按以下顺序拼接，字段之间使用 &amp; 分隔，请求方式使用大写。</p>
			<pre>
UPPER_METHOD&amp;PATH&amp;KEY&amp;TIMESTAMP&amp;NONCE
GET&amp;/api/example/action&amp;YOUR_ACCESS_KEY&amp;1700000000&amp;123456</pre>
			<p>PATH 只包含以 / 开头的接口路径，不包含协议、域名、查询参数或片段。密钥使用 YOUR_ACCESS_SECRET 占位。</p>
			<pre>sign = Base64(HMACSHA256(YOUR_ACCESS_SECRET, message))</pre>
		</div>
		<template #footer><Button :auto-insert-space="false" @click="emit('close')">关闭</Button></template>
	</Modal>
</template>

<style scoped>
.open-access-help table {
	width: 100%;
	border-collapse: collapse;
	margin: 16px 0;
}
.open-access-help th,
.open-access-help td {
	padding: 8px;
	border: 1px solid hsl(var(--border));
	text-align: left;
}
.open-access-help pre {
	padding: 12px;
	margin: 16px 0;
	border-radius: 6px;
	background: hsl(var(--muted));
	overflow-x: auto;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
</style>
