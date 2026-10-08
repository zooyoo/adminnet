import { SysCacheApi } from '#/api-services/apis/sys-cache-api';
import { getAPI } from '#/api/sdk';

export const cacheKeys = async () => (await getAPI(SysCacheApi).apiSysCacheKeyListGet()).data.result ?? [];
export const cacheValue = async (key: string, signal?: AbortSignal) => (await getAPI(SysCacheApi).apiSysCacheValueKeyGet(key, { signal })).data.result;
export const removeCache = (key: string) => getAPI(SysCacheApi).apiSysCacheDeleteKeyPost(key);
export const clearCache = () => getAPI(SysCacheApi).apiSysCacheClearPost();
