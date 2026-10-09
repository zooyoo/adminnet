import type { DbColumnInput, DbColumnOutput, DbTableInfo, DbTableInput, MoveDbColumnInput, UpdateDbColumnInput, UpdateDbTableInput } from '#/api-services/models';

import { SysDatabaseApi } from '#/api-services/apis/sys-database-api';
import { requestClient } from '#/api/request';
import { getAPI } from '#/api/sdk';

export interface DatabaseConnection {
	configId: string;
	dbNickName: string;
	dbType: string;
	canMoveColumn: boolean;
}
export interface DatabaseTarget {
	configId: string;
	tableName: string;
}
export const databaseConnections = (signal?: AbortSignal) => requestClient.get<DatabaseConnection[]>('/api/sysDatabase/list', { signal });
export async function databaseTables(configId: string, signal?: AbortSignal): Promise<DbTableInfo[]> {
	return (await getAPI(SysDatabaseApi).apiSysDatabaseTableListConfigIdGet(configId, { signal })).data.result ?? [];
}
export async function databaseTypes(configId: string, signal?: AbortSignal): Promise<string[]> {
	return (await getAPI(SysDatabaseApi).apiSysDatabaseDbTypeListConfigIdGet(configId, { signal })).data.result ?? [];
}
export async function databaseColumns(target: DatabaseTarget, signal?: AbortSignal): Promise<DbColumnOutput[]> {
	return (await getAPI(SysDatabaseApi).apiSysDatabaseColumnListTableNameConfigIdGet(target.tableName, target.configId, { signal })).data.result ?? [];
}
export const databaseActions = {
	addTable: (input: DbTableInput, signal?: AbortSignal) => getAPI(SysDatabaseApi).apiSysDatabaseAddTablePost(input, { signal }),
	updateTable: (input: UpdateDbTableInput, signal?: AbortSignal) => getAPI(SysDatabaseApi).apiSysDatabaseUpdateTablePost(input, { signal }),
	addColumn: (input: DbColumnInput, signal?: AbortSignal) => getAPI(SysDatabaseApi).apiSysDatabaseAddColumnPost(input, { signal }),
	updateColumn: (input: UpdateDbColumnInput, signal?: AbortSignal) => getAPI(SysDatabaseApi).apiSysDatabaseUpdateColumnPost(input, { signal }),
	deleteColumn: (target: DatabaseTarget, dbColumnName: string, signal?: AbortSignal) => getAPI(SysDatabaseApi).apiSysDatabaseDeleteColumnPost({ ...target, dbColumnName }, { signal }),
	moveColumn: (input: MoveDbColumnInput, signal?: AbortSignal) => getAPI(SysDatabaseApi).apiSysDatabaseMoveColumnPost(input, { signal }),
};
