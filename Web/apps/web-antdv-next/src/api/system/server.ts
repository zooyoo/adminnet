import type { NuGetPackage, SystemHardwareInfo, SystemRuntimeInfo } from '#/api-services/models';

import { SysServerApi } from '#/api-services/apis/sys-server-api';
import { getAPI } from '#/api/sdk';

export type ServerHardware = Omit<SystemHardwareInfo, 'cpuInfo'> & {
	cpuInfo?: Omit<NonNullable<SystemHardwareInfo['cpuInfo']>, 'usagePercentage'> & { usagePercentage?: null | number };
};
export const serverHardware = async (signal?: AbortSignal): Promise<ServerHardware | undefined> => (await getAPI(SysServerApi).apiSysServerHardwareInfoGet({ signal })).data.result;
export const serverRuntime = async (signal?: AbortSignal): Promise<SystemRuntimeInfo | undefined> => (await getAPI(SysServerApi).apiSysServerRuntimeInfoGet({ signal })).data.result;
export const serverPackages = async (signal?: AbortSignal): Promise<NuGetPackage[]> => (await getAPI(SysServerApi).apiSysServerNuGetPackageInfoGet({ signal })).data.result ?? [];
