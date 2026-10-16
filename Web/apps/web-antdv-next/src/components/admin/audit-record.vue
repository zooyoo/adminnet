<script setup lang="ts">
import { Button, Descriptions, DescriptionsItem, Popover } from 'antdv-next';
defineProps<{ record: { createUserName?: null | string; updateUserName?: null | string; remark?: null | string; createTime?: Date | null | string; updateTime?: Date | null | string } }>();
</script>

<template>
	<Popover trigger="click">
		<Button type="link" size="small">修改记录</Button>
		<template #content>
			<Descriptions :column="1" size="small">
				<DescriptionsItem label="创建人">{{ record.createUserName || '-' }}</DescriptionsItem>
				<DescriptionsItem label="创建时间">{{ record.createTime || '-' }}</DescriptionsItem>
				<DescriptionsItem label="修改人">{{ record.updateUserName || '-' }}</DescriptionsItem>
				<DescriptionsItem label="修改时间">{{ record.updateTime || '-' }}</DescriptionsItem>
				<DescriptionsItem v-if="'remark' in record" label="备注">{{ record.remark ?? '无' }}</DescriptionsItem>
			</Descriptions>
		</template>
	</Popover>
</template>
