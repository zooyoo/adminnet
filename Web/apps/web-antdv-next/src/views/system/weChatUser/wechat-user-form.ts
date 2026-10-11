import type { WechatUserDraft, WechatUserRow } from '#/api/system/wechat-user';

export const wechatPlatforms = [
	{ label: '微信公众号', value: 1 },
	{ label: '微信小程序', value: 2 },
	{ label: 'QQ', value: 3 },
	{ label: '支付宝', value: 4 },
	{ label: 'Gitee', value: 5 },
];

/** 按字段创建独立草稿，避免将服务端额外字段或凭据回传。 */
export function createWechatUserDraft(row?: WechatUserRow): WechatUserDraft {
	return {
		id: row?.id,
		userId: row?.userId ?? '0',
		platformType: row?.platformType ?? 1,
		openId: row?.openId ?? '',
		unionId: row?.unionId ?? null,
		nickName: row?.nickName ?? null,
		avatar: row?.avatar ?? null,
		mobile: row?.mobile ?? null,
		sex: row?.sex ?? null,
		language: row?.language ?? null,
		city: row?.city ?? null,
		province: row?.province ?? null,
		country: row?.country ?? null,
	};
}

/** 使用字符串校验雪花 ID，避免经过 Number 丢失精度。 */
export function validateWechatUserDraft(draft: WechatUserDraft, superAdmin: boolean): string {
	const userId = String(draft.userId);
	if (!/^\d+$/.test(userId) || BigInt(userId) > 9_223_372_036_854_775_807n || (!superAdmin && BigInt(userId) === 0n)) return '请输入有效的关联账号 ID';
	if (!wechatPlatforms.some((item) => item.value === draft.platformType)) return '请选择平台类型';
	if (!draft.openId.trim()) return '请输入 OpenId';
	for (const [key, label, maximum] of [
		['openId', 'OpenId', 64],
		['unionId', 'UnionId', 64],
		['nickName', '昵称', 64],
		['avatar', '头像地址', 256],
		['mobile', '手机号', 16],
		['language', '语言', 64],
		['city', '城市', 64],
		['province', '省份', 64],
		['country', '国家', 64],
	] as const) {
		if ((draft[key]?.length ?? 0) > maximum) return `${label}不能超过 ${maximum} 个字符`;
	}
	if (draft.sex !== null && ![0, 1, 2].includes(draft.sex)) return '请选择有效的性别';
	if (draft.avatar && !safeWechatAvatar(draft.avatar)) return '头像必须为 HTTP、HTTPS 或站内绝对路径';
	return '';
}

export function safeWechatAvatar(value?: null | string): string | undefined {
	if (!value || value.includes('\\')) return undefined;
	if (value.startsWith('/') && !value.startsWith('//')) return value;
	try {
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) ? value : undefined;
	} catch {
		return undefined;
	}
}
