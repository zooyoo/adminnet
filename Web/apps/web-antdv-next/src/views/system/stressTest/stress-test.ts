import type { StressTestOutput, StressTestPair, StressTestPolicy, StressTestRequest, StressTestTarget } from '#/api/system/stress-test';

export interface StressTestForm {
	requestUri: string;
	requestMethod: string;
	numberOfRequests: null | number;
	numberOfRounds: null | number;
	maxDegreeOfParallelism: null | number;
	requestParameters: StressTestPair[];
	headers: StressTestPair[];
	pathParameters: StressTestPair[];
	queryParameters: StressTestPair[];
}

export interface StressTestIssue {
	field: 'target' | keyof StressTestForm;
	message: string;
	row?: number;
}

export const parameterGroups = [
	{ key: 'headers', label: 'Headers', description: '请求头不自动填入登录凭据。参数仅保存在当前页面内存中。' },
	{ key: 'requestParameters', label: 'Body', description: 'application/x-www-form-urlencoded 表单；允许同名 key。GET 不发送 Body。' },
	{ key: 'pathParameters', label: 'Path', description: '将请求地址中的 {key} 替换为对应值。替换后仍须位于授权 URI 前缀内。' },
	{ key: 'queryParameters', label: 'Query', description: '追加 Query 参数；同名参数按服务端规则覆盖地址中的已有值。' },
] as const;

export function createStressTestForm(): StressTestForm {
	return { requestUri: '', requestMethod: 'GET', numberOfRequests: 100, numberOfRounds: 1, maxDegreeOfParallelism: 0, requestParameters: [], headers: [], pathParameters: [], queryParameters: [] };
}

function absoluteHttpUrl(value: string): undefined | URL {
	try {
		const url = new URL(value);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || value.includes('\\')) return;
		return url;
	} catch {
		return;
	}
}

export function parseStressTestPolicy(value: unknown): StressTestPolicy {
	if (!value || typeof value !== 'object') throw new Error('压测目标配置格式无效');
	const policy = value as StressTestPolicy;
	for (const key of ['maxTotalRequests', 'maxConcurrency', 'maxRounds', 'maxRequestsPerRound', 'requestTimeoutSeconds'] as const) {
		if (!Number.isSafeInteger(policy[key]) || policy[key] <= 0) throw new Error('压测限制配置无效，请联系管理员');
	}
	if (!Array.isArray(policy.targets)) throw new Error('压测目标配置格式无效');
	const seen = new Set<string>();
	for (const target of policy.targets) {
		const url = typeof target?.requestUri === 'string' ? absoluteHttpUrl(target.requestUri) : undefined;
		if (!target || typeof target.name !== 'string' || !target.name.trim() || !url || url.search || seen.has(url.href)) throw new Error('授权目标 URI 配置无效，请联系管理员');
		seen.add(url.href);
	}
	return policy;
}

export function isWithinStressTarget(requestUri: string, target: StressTestTarget): boolean {
	const request = absoluteHttpUrl(requestUri);
	const prefix = absoluteHttpUrl(target.requestUri);
	if (!request || !prefix || prefix.search || request.origin !== prefix.origin) return false;
	const path = prefix.pathname.endsWith('/') ? prefix.pathname : `${prefix.pathname}/`;
	return request.pathname === prefix.pathname || request.pathname.startsWith(path);
}

export function validateStressTest(form: StressTestForm, policy: StressTestPolicy | undefined, targetUri: string) {
	const issues: StressTestIssue[] = [];
	const target = policy?.targets.find((item) => item.requestUri === targetUri);
	if (!policy || !target) issues.push({ field: 'target', message: '请选择当前服务端允许的压测目标' });
	const integer = (field: 'maxDegreeOfParallelism' | 'numberOfRequests' | 'numberOfRounds', min: number, max: number | undefined, label: string) => {
		const value = form[field];
		if (value === null || !Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
			issues.push({ field, message: `${label}须为 ${min} 至 ${max ?? '配置上限'} 的整数` });
		}
	};
	integer('numberOfRequests', 1, policy?.maxRequestsPerRound, '每轮请求量');
	integer('numberOfRounds', 1, policy?.maxRounds, '压测轮数');
	integer('maxDegreeOfParallelism', 0, policy?.maxConcurrency, '最大并行量');
	if (
		form.numberOfRequests !== null &&
		form.numberOfRounds !== null &&
		policy &&
		(!Number.isSafeInteger(form.numberOfRequests * form.numberOfRounds) || form.numberOfRequests * form.numberOfRounds > policy.maxTotalRequests)
	) {
		issues.push({ field: 'numberOfRequests', message: `每轮请求量 × 压测轮数不得超过 ${policy.maxTotalRequests} 次` });
	}
	if (!['DELETE', 'GET', 'POST', 'PUT'].includes(form.requestMethod)) issues.push({ field: 'requestMethod', message: '仅支持 GET、POST、PUT、DELETE' });
	for (const group of parameterGroups) {
		const keys = new Set<string>();
		form[group.key].forEach((pair, row) => {
			if (!pair.key.trim()) issues.push({ field: group.key, row, message: `${group.label} 第 ${row + 1} 行参数名不能为空` });
			const normalized = pair.key.toLowerCase();
			if (group.key !== 'requestParameters' && keys.has(normalized)) issues.push({ field: group.key, row, message: `${group.label} 第 ${row + 1} 行参数名重复（不区分大小写）` });
			keys.add(normalized);
			if (group.key === 'headers' && (!/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(pair.key) || /[\r\n]/.test(pair.value))) {
				issues.push({ field: group.key, row, message: `Headers 第 ${row + 1} 行名称或值不是有效的 HTTP 请求头` });
			}
		});
	}
	let previewUri = form.requestUri.trim();
	const paths = new Map(form.pathParameters.map((pair) => [pair.key.toLowerCase(), pair.value]));
	previewUri = previewUri.replace(/\{([^{}]+)\}/g, (placeholder, key: string) => {
		const value = paths.get(key.toLowerCase());
		if (value === undefined) {
			issues.push({ field: 'pathParameters', message: `缺少路径参数 ${placeholder}` });
			return placeholder;
		}
		return encodeURIComponent(value);
	});
	if (!previewUri || !absoluteHttpUrl(previewUri) || /[{}]/.test(previewUri)) issues.push({ field: 'requestUri', message: '请输入有效的完整 HTTP(S) 请求地址，并填写所有 Path 参数' });
	else if (target && (!isWithinStressTarget(form.requestUri.trim(), target) || !isWithinStressTarget(previewUri, target)))
		issues.push({ field: 'requestUri', message: '请求地址须位于当前授权目标的 URI 前缀内' });
	const dictionary = (pairs: StressTestPair[]) => Object.fromEntries(pairs.map((pair) => [pair.key, pair.value]));
	const request: StressTestRequest | undefined = issues.length
		? undefined
		: {
				requestUri: form.requestUri.trim(),
				requestMethod: form.requestMethod as StressTestRequest['requestMethod'],
				numberOfRequests: form.numberOfRequests!,
				numberOfRounds: form.numberOfRounds!,
				maxDegreeOfParallelism: form.maxDegreeOfParallelism!,
				requestParameters: form.requestParameters.map((pair) => ({ ...pair })),
				headers: dictionary(form.headers),
				pathParameters: dictionary(form.pathParameters),
				queryParameters: dictionary(form.queryParameters),
			};
	return { issues, request, previewUri };
}

export interface StressTestState {
	policy?: StressTestPolicy;
	targetStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
	targetError: string;
	status: 'cancelled' | 'completed' | 'error' | 'idle' | 'running';
	result?: StressTestOutput;
	error: string;
}

interface Boundary {
	readonly version: number;
	track: (controller: AbortController) => void;
	release: (controller: AbortController) => void;
}

interface StressTestSessionOptions {
	boundary: Boundary;
	allowed: () => boolean;
	fetchTargets: (signal: AbortSignal) => Promise<StressTestPolicy>;
	run: (input: StressTestRequest, signal: AbortSignal) => Promise<StressTestOutput>;
	onChange: (state: StressTestState) => void;
	onClear?: () => void;
}

// 会话公开状态只接受当前页面、当前身份和当前请求的响应。
export class StressTestSession {
	private active = false;
	private generation = 0;
	private readonly identityVersion: number;
	private readonly lifetime = new AbortController();
	private operation?: AbortController;
	private state: StressTestState = { targetStatus: 'idle', targetError: '', status: 'idle', error: '' };

	constructor(private readonly options: StressTestSessionOptions) {
		this.identityVersion = options.boundary.version;
		options.boundary.track(this.lifetime);
		this.lifetime.signal.addEventListener('abort', this.clearIdentity);
	}

	activate() {
		if (this.active || this.lifetime.signal.aborted || !this.options.allowed()) return;
		this.active = true;
		return this.refreshTargets();
	}

	cancel() {
		if (this.state.status !== 'running') return;
		this.abortOperation();
		this.publish({ status: 'cancelled', result: undefined, error: '' });
	}

	deactivate() {
		this.active = false;
		this.reset();
	}

	dispose() {
		this.deactivate();
		this.lifetime.signal.removeEventListener('abort', this.clearIdentity);
		this.lifetime.abort();
		this.options.boundary.release(this.lifetime);
	}

	async execute(input: StressTestRequest) {
		if (!this.current() || this.state.status === 'running' || this.state.targetStatus !== 'ready') return;
		const { controller, generation } = this.begin();
		this.publish({ status: 'running', result: undefined, error: '' });
		try {
			const result = await this.options.run(input, controller.signal);
			if (!this.current(generation)) return;
			if (!result || typeof result !== 'object') throw new Error('服务端未返回压测结果');
			this.publish({ status: 'completed', result });
		} catch (error) {
			if (this.current(generation)) this.publish({ status: 'error', error: error instanceof Error ? error.message : '压测请求失败，请稍后重试' });
		} finally {
			this.finish(controller);
		}
	}

	invalidateIdentity() {
		this.lifetime.abort();
	}

	async refreshTargets() {
		if (!this.current() || this.state.status === 'running' || this.state.targetStatus === 'loading') return;
		const { controller, generation } = this.begin();
		this.publish({ targetStatus: 'loading', policy: undefined, targetError: '', result: undefined, status: 'idle', error: '' });
		try {
			const policy = parseStressTestPolicy(await this.options.fetchTargets(controller.signal));
			if (!this.current(generation)) return;
			this.publish({ policy, targetStatus: policy.targets.length ? 'ready' : 'unavailable', targetError: policy.targets.length ? '' : '服务端未配置授权压测目标，当前不可执行' });
		} catch (error) {
			if (this.current(generation)) this.publish({ targetStatus: 'unavailable', targetError: error instanceof Error ? error.message : '无法读取授权压测目标，当前不可执行' });
		} finally {
			this.finish(controller);
		}
	}

	private abortOperation() {
		this.generation++;
		if (this.operation) {
			this.operation.abort();
			this.options.boundary.release(this.operation);
			this.operation = undefined;
		}
	}

	private begin() {
		this.abortOperation();
		const controller = new AbortController();
		this.operation = controller;
		this.options.boundary.track(controller);
		return { controller, generation: this.generation };
	}

	private readonly clearIdentity = () => {
		this.active = false;
		this.reset();
	};

	private current(generation = this.generation) {
		return this.active && this.options.allowed() && !this.lifetime.signal.aborted && this.options.boundary.version === this.identityVersion && generation === this.generation;
	}

	private finish(controller: AbortController) {
		this.options.boundary.release(controller);
		if (this.operation === controller) this.operation = undefined;
	}

	private publish(patch: Partial<StressTestState>) {
		this.state = { ...this.state, ...patch };
		this.options.onChange({ ...this.state });
	}

	private reset() {
		this.abortOperation();
		this.publish({ policy: undefined, targetStatus: 'idle', targetError: '', status: 'idle', result: undefined, error: '' });
		this.options.onClear?.();
	}
}
