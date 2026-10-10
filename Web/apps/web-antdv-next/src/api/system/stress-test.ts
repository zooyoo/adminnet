import type { StressTestOutput } from '#/api-services/models';

import { requestClient } from '#/api/request';

export type { StressTestOutput };

export interface StressTestTarget {
	name: string;
	requestUri: string;
}

export interface StressTestPolicy {
	targets: StressTestTarget[];
	maxTotalRequests: number;
	maxConcurrency: number;
	maxRounds: number;
	maxRequestsPerRound: number;
	requestTimeoutSeconds: number;
}

export interface StressTestPair {
	key: string;
	value: string;
}

export interface StressTestRequest {
	requestUri: string;
	requestMethod: 'DELETE' | 'GET' | 'POST' | 'PUT';
	numberOfRequests: number;
	numberOfRounds: number;
	maxDegreeOfParallelism: number;
	requestParameters: StressTestPair[];
	headers: Record<string, string>;
	pathParameters: Record<string, string>;
	queryParameters: Record<string, string>;
}

export const getStressTestTargets = (signal?: AbortSignal): Promise<StressTestPolicy> => requestClient.get('/api/sysCommon/stressTestTargets', { signal });

// 单个目标请求的超时由服务端限制；整次压测等待期间允许用户随时取消。
export const runStressTest = (input: StressTestRequest, signal?: AbortSignal): Promise<StressTestOutput> => requestClient.post('/api/sysCommon/stressTest', input, { signal, timeout: 0 });
