import type { InfoSaveInput } from '#/api-services/models';

import { SysConfigApi } from '#/api-services/apis/sys-config-api';
import { requestClient } from '#/api/request';
import { getAPI } from '#/api/sdk';

export interface SiteInfo extends InfoSaveInput {
	logo?: string;
	wayList?: Array<{ label: string; value: number }>;
}
export const getSiteInfo = () => requestClient.get<SiteInfo>('/api/sysConfig/sysInfo');
export const saveSiteInfo = (value: InfoSaveInput) => getAPI(SysConfigApi).apiSysConfigSaveSysInfoPost(value);
export function siteDraft(data?: SiteInfo): InfoSaveInput {
	return {
		title: data?.title ?? '',
		viceTitle: data?.viceTitle ?? '',
		viceDesc: data?.viceDesc ?? '',
		watermark: data?.watermark ?? '',
		copyright: data?.copyright ?? '',
		icp: data?.icp ?? '',
		icpUrl: data?.icpUrl ?? '',
		enableReg: data?.enableReg ?? 2,
		regWayId: data?.regWayId,
		secondVer: data?.secondVer,
		captcha: data?.captcha,
	};
}
