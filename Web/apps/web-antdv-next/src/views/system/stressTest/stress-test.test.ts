import type { StressTestOutput, StressTestPolicy, StressTestRequest } from '../../../api/system/stress-test';
import type { StressTestState } from './stress-test';

import { describe, expect, it, vi } from 'vitest';

import { SessionBoundary } from '../../../api/session';
import { createStressTestForm, isWithinStressTarget, parseStressTestPolicy, StressTestSession, validateStressTest } from './stress-test';

const policy: StressTestPolicy = {
	targets: [{ name: '隔离测试目标', requestUri: 'http://127.0.0.1:43123/probe/' }],
	maxTotalRequests: 10_000,
	maxConcurrency: 64,
	maxRounds: 100,
	maxRequestsPerRound: 1000,
	requestTimeoutSeconds: 10,
};
const output: StressTestOutput = { totalRequests: 100, successfulRequests: 90, failedRequests: 10, queriesPerSecond: 25, totalTimeInSeconds: 4 };
function validForm() {
	return { ...createStressTestForm(), requestUri: policy.targets[0]!.requestUri };
}
function validRequest() {
	const request = validateStressTest(validForm(), policy, policy.targets[0]!.requestUri).request;
	if (!request) throw new Error('测试输入必须有效');
	return request;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
function harness(options: { fetchTargets?: (signal: AbortSignal) => Promise<StressTestPolicy>; run?: (input: StressTestRequest, signal: AbortSignal) => Promise<StressTestOutput> } = {}) {
	const boundary = new SessionBoundary();
	let current: StressTestState = { targetStatus: 'idle', targetError: '', status: 'idle', error: '' };
	let allowed = true;
	const onClear = vi.fn();
	const fetchTargets = vi.fn<(signal: AbortSignal) => Promise<StressTestPolicy>>(options.fetchTargets ?? (async () => policy));
	const run = vi.fn<(input: StressTestRequest, signal: AbortSignal) => Promise<StressTestOutput>>(options.run ?? (async () => output));
	const session = new StressTestSession({
		boundary,
		allowed: () => allowed,
		fetchTargets,
		run,
		onClear,
		onChange: (state) => {
			current = state;
		},
	});
	return {
		session,
		boundary,
		fetchTargets,
		run,
		onClear,
		get state() {
			return current;
		},
		setAllowed(value: boolean) {
			allowed = value;
		},
	};
}

describe('受控压测参数契约', () => {
	it('默认地址为空，并行量 0 保留服务器默认语义', () => {
		expect(createStressTestForm().requestUri).toBe('');
		const result = validateStressTest(validForm(), policy, policy.targets[0]!.requestUri);
		expect(result.issues).toEqual([]);
		expect(result.request?.maxDegreeOfParallelism).toBe(0);
	});

	it.each(['GET', 'POST', 'PUT', 'DELETE'])('保留 %s 方法和每轮请求量 × 轮数', (requestMethod) => {
		const form = { ...validForm(), requestMethod, numberOfRequests: 1000, numberOfRounds: 10, maxDegreeOfParallelism: 64 };
		expect(validateStressTest(form, policy, policy.targets[0]!.requestUri).request).toMatchObject({ requestMethod, numberOfRequests: 1000, numberOfRounds: 10, maxDegreeOfParallelism: 64 });
	});

	it.each([
		{ numberOfRequests: 0 },
		{ numberOfRequests: 1.5 },
		{ numberOfRequests: null },
		{ numberOfRequests: 1001 },
		{ numberOfRounds: 0 },
		{ numberOfRounds: 101 },
		{ numberOfRounds: 1.5 },
		{ maxDegreeOfParallelism: -1 },
		{ maxDegreeOfParallelism: 65 },
		{ maxDegreeOfParallelism: null },
		{ numberOfRequests: 1000, numberOfRounds: 11 },
		{ requestMethod: 'PATCH' },
	])('拒绝超过限制或非整数的输入 %j', (patch) => {
		const result = validateStressTest({ ...validForm(), ...patch }, policy, policy.targets[0]!.requestUri);
		expect(result.issues.length).toBeGreaterThan(0);
		expect(result.request).toBeUndefined();
	});

	it('配置为空、未选择目标或目标不在当前配置中时不可执行', () => {
		expect(validateStressTest(validForm(), undefined, '').request).toBeUndefined();
		expect(validateStressTest(validForm(), { ...policy, targets: [] }, policy.targets[0]!.requestUri).request).toBeUndefined();
		expect(validateStressTest(validForm(), policy, 'http://127.0.0.1:43123/other/').request).toBeUndefined();
	});

	it('保留 Body 重复 key 和空值，Headers、Path、Query 序列化为字典', () => {
		const form = validForm();
		form.requestParameters = [
			{ key: 'tag', value: 'one' },
			{ key: 'tag', value: '' },
		];
		form.headers = [{ key: 'X-Probe', value: 'local' }];
		form.pathParameters = [{ key: 'id', value: '42' }];
		form.queryParameters = [{ key: 'q', value: '' }];
		const result = validateStressTest(form, policy, policy.targets[0]!.requestUri);
		expect(result.issues).toEqual([]);
		expect(result.request).toMatchObject({
			requestParameters: [
				{ key: 'tag', value: 'one' },
				{ key: 'tag', value: '' },
			],
			headers: { 'X-Probe': 'local' },
			pathParameters: { id: '42' },
			queryParameters: { q: '' },
		});
		form.requestParameters[0]!.value = 'edited';
		expect(result.request?.requestParameters[0]?.value).toBe('one');
	});

	it.each(['headers', 'pathParameters', 'queryParameters'] as const)('%s 拒绝大小写不同的重复 key', (group) => {
		const form = validForm();
		form[group] = [
			{ key: 'Key', value: 'one' },
			{ key: 'key', value: 'two' },
		];
		expect(validateStressTest(form, policy, policy.targets[0]!.requestUri).issues).toContainEqual(expect.objectContaining({ field: group, row: 1 }));
	});

	it.each(['headers', 'requestParameters', 'pathParameters', 'queryParameters'] as const)('%s 拒绝空白 key', (group) => {
		const form = validForm();
		form[group] = [{ key: '   ', value: 'value' }];
		expect(validateStressTest(form, policy, policy.targets[0]!.requestUri).request).toBeUndefined();
	});

	it('Headers 拒绝非法 token 和 CRLF 注入', () => {
		const form = validForm();
		form.headers = [
			{ key: 'Bad Name', value: 'value' },
			{ key: 'X-Probe', value: 'one\r\ntwo' },
		];
		expect(validateStressTest(form, policy, policy.targets[0]!.requestUri).issues.filter((issue) => issue.field === 'headers')).toHaveLength(2);
	});

	it.each([
		'http://127.0.0.1:43123/probe-other/test',
		'http://127.0.0.1:43124/probe/',
		'http://localhost:43123/probe/',
		'https://example.com/probe/',
		'http://user:pass@127.0.0.1:43123/probe/',
		'http://127.0.0.1:43123/probe/#fragment',
		'http://127.0.0.1:43123/probe/%2e%2e/other/',
		'javascript:alert(1)',
		'/probe/',
	])('拒绝离开授权 URI 的地址 %s', (requestUri) => {
		expect(isWithinStressTarget(requestUri, policy.targets[0]!)).toBe(false);
		expect(validateStressTest({ ...validForm(), requestUri }, policy, policy.targets[0]!.requestUri).request).toBeUndefined();
	});

	it('Path 替换不区分大小写并编码值，同时检查缺少参数与替换后越界', () => {
		const form = { ...validForm(), requestUri: `${policy.targets[0]!.requestUri}path/{ID}` };
		expect(validateStressTest(form, policy, policy.targets[0]!.requestUri).request).toBeUndefined();
		form.pathParameters = [{ key: 'id', value: 'alice & bob' }];
		expect(validateStressTest(form, policy, policy.targets[0]!.requestUri).previewUri).toBe(`${policy.targets[0]!.requestUri}path/alice%20%26%20bob`);
		expect(validateStressTest(form, policy, policy.targets[0]!.requestUri).issues).toEqual([]);
		form.requestUri = `${policy.targets[0]!.requestUri}{ID}/other`;
		form.pathParameters[0]!.value = '..';
		expect(validateStressTest(form, policy, policy.targets[0]!.requestUri).request).toBeUndefined();
	});

	it('服务端限制和目标配置格式无效时拒绝加载，不采用默认外网目标', () => {
		expect(parseStressTestPolicy({ ...policy, targets: [] }).targets).toEqual([]);
		for (const value of [
			undefined,
			{},
			{ ...policy, maxTotalRequests: 0 },
			{ ...policy, maxConcurrency: 1.5 },
			{ ...policy, targets: [{ name: 'bad', requestUri: 'https://user:pass@example.com/' }] },
			{ ...policy, targets: [policy.targets[0], policy.targets[0]] },
		]) {
			expect(() => parseStressTestPolicy(value)).toThrow();
		}
	});
});

describe('压测会话公开行为与迟到响应', () => {
	it('加载目标和运行状态明确区分，重复激活只请求一次', async () => {
		const targets = deferred<StressTestPolicy>();
		const request = deferred<StressTestOutput>();
		const test = harness({ fetchTargets: () => targets.promise, run: () => request.promise });
		const loading = test.session.activate();
		void test.session.activate();
		expect(test.state.targetStatus).toBe('loading');
		expect(test.state.status).toBe('idle');
		expect(test.fetchTargets).toHaveBeenCalledTimes(1);
		targets.resolve(policy);
		await loading;
		const execution = test.session.execute(validRequest());
		void test.session.execute(validRequest());
		void test.session.refreshTargets();
		expect(test.run).toHaveBeenCalledTimes(1);
		expect(test.state.status).toBe('running');
		request.resolve(output);
		await execution;
		expect(test.state).toMatchObject({ status: 'completed', result: output, error: '' });
		test.session.dispose();
	});

	it('空目标或读取失败显示 unavailable 且不调用执行 API', async () => {
		for (const fetchTargets of [
			async () => ({ ...policy, targets: [] }),
			async () => {
				throw new Error('读取失败');
			},
		]) {
			const test = harness({ fetchTargets });
			await test.session.activate();
			await test.session.execute(validRequest());
			expect(test.state.targetStatus).toBe('unavailable');
			expect(test.state.targetError).not.toBe('');
			expect(test.run).not.toHaveBeenCalled();
			test.session.dispose();
		}
	});

	it('取消会 abort、清空结果并保留 cancelled，晚到成功和失败都不回填', async () => {
		for (const shouldReject of [false, true]) {
			const request = deferred<StressTestOutput>();
			const test = harness({ run: () => request.promise });
			await test.session.activate();
			const execution = test.session.execute(validRequest());
			const signal = test.run.mock.calls[0]![1];
			test.session.cancel();
			expect(signal.aborted).toBe(true);
			expect(test.state).toMatchObject({ status: 'cancelled', result: undefined, error: '' });
			if (shouldReject) request.reject(new Error('迟到失败'));
			else request.resolve(output);
			await execution;
			expect(test.state.status).toBe('cancelled');
			expect(test.state.result).toBeUndefined();
			test.session.dispose();
		}
	});

	it.each(['deactivate', 'dispose', 'invalidateIdentity'] as const)('%s 清除敏感表单与结果，迟到响应无效', async (action) => {
		const request = deferred<StressTestOutput>();
		const test = harness({ run: () => request.promise });
		await test.session.activate();
		const execution = test.session.execute(validRequest());
		test.session[action]();
		expect(test.run.mock.calls[0]![1].aborted).toBe(true);
		expect(test.state).toMatchObject({ status: 'idle', targetStatus: 'idle', result: undefined, policy: undefined });
		expect(test.onClear).toHaveBeenCalled();
		request.resolve(output);
		await execution;
		expect(test.state.result).toBeUndefined();
		test.session.dispose();
	});

	it('sessionBoundary 身份失效立即清结果和 abort，无法重新激活旧身份会话', async () => {
		const request = deferred<StressTestOutput>();
		const test = harness({ run: () => request.promise });
		await test.session.activate();
		const execution = test.session.execute(validRequest());
		test.boundary.invalidate();
		expect(test.state.result).toBeUndefined();
		expect(test.run.mock.calls[0]![1].aborted).toBe(true);
		request.resolve(output);
		await execution;
		await test.session.activate();
		expect(test.state.status).toBe('idle');
		expect(test.fetchTargets).toHaveBeenCalledTimes(1);
		test.session.dispose();
	});

	it('keepalive 重新激活重新加载目标，旧 targets 响应无法覆盖新配置', async () => {
		const oldTargets = deferred<StressTestPolicy>();
		let calls = 0;
		const test = harness({ fetchTargets: () => (++calls === 1 ? oldTargets.promise : Promise.resolve(policy)) });
		const first = test.session.activate();
		test.session.deactivate();
		await test.session.activate();
		oldTargets.resolve({ ...policy, targets: [] });
		await first;
		expect(test.state).toMatchObject({ targetStatus: 'ready', policy });
		test.session.dispose();
	});

	it('允许的新执行完成后，先前取消请求晚到不覆盖新结果', async () => {
		const oldRequest = deferred<StressTestOutput>();
		let calls = 0;
		const newest = { ...output, totalRequests: 50 };
		const test = harness({ run: () => (++calls === 1 ? oldRequest.promise : Promise.resolve(newest)) });
		await test.session.activate();
		const old = test.session.execute(validRequest());
		test.session.cancel();
		await test.session.execute(validRequest());
		oldRequest.resolve(output);
		await old;
		expect(test.state).toMatchObject({ status: 'completed', result: newest });
		test.session.dispose();
	});

	it('全部失败仍是 completed，执行 API 异常为 error，二者均不混淆为成功', async () => {
		const failed = { totalRequests: 100, successfulRequests: 0, failedRequests: 100 };
		const test = harness({ run: async () => failed });
		await test.session.activate();
		await test.session.execute(validRequest());
		expect(test.state).toMatchObject({ status: 'completed', result: failed });
		test.session.dispose();
		const errorTest = harness({
			run: async () => {
				throw new Error('服务器不可用');
			},
		});
		await errorTest.session.activate();
		await errorTest.session.execute(validRequest());
		expect(errorTest.state).toMatchObject({ status: 'error', error: '服务器不可用', result: undefined });
		errorTest.session.dispose();
	});

	it('权限不足时不加载目标，不发出压测请求', async () => {
		const test = harness();
		test.setAllowed(false);
		await test.session.activate();
		await test.session.execute(validRequest());
		expect(test.fetchTargets).not.toHaveBeenCalled();
		expect(test.run).not.toHaveBeenCalled();
		test.session.dispose();
	});
});
