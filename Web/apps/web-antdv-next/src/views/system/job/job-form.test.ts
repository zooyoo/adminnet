import { describe, expect, it } from 'vitest';

import { cronArgs, httpFields, jobDraft, jobPayload, parseCronArgs, triggerDraft, wallTime } from './job-form';

describe('job public editor contract', () => {
	it('preserves cron lists, ranges and explicit format instead of splitting at commas', () => {
		const source = '0 0 9,12 * * MON-FRI';
		expect(parseCronArgs(cronArgs(source, 2))).toEqual({ expression: source, format: 2 });
		expect(parseCronArgs(`[${cronArgs(source, 2)}]`)).toEqual({ expression: source, format: 2 });
	});
	it.each(['"invalid"', '"* * * * *",9', '42,2', ''])('rejects malformed cron arguments: %s', (value) => expect(() => parseCronArgs(value)).toThrow());
	it('keeps task identity, creation type and custom properties on HTTP edits', () => {
		const original = {
			jobId: 'http-test',
			id: 1,
			createType: 2,
			properties: JSON.stringify({ custom: { retained: true }, HttpJob: JSON.stringify({ RequestUri: 'https://old.test', HttpMethod: { Method: 'POST' }, Timeout: 5000 }) }),
		};
		const draft = jobDraft(original);
		const http = httpFields(draft.properties);
		http.uri = 'https://new.test';
		const result = jobPayload(draft, http);
		expect(result).toMatchObject({ jobId: 'http-test', id: 1, createType: 2 });
		const properties = JSON.parse(result.properties!);
		expect(properties.custom).toEqual({ retained: true });
		expect(JSON.parse(properties.HttpJob)).toMatchObject({ RequestUri: 'https://new.test', HttpMethod: { Method: 'POST' }, Timeout: 5000 });
		expect(httpFields(original.properties).uri).toBe('https://old.test');
	});
	it('rejects script-less tasks, invalid property objects and unsafe protocols', () => {
		expect(() => jobPayload({ jobId: 'script', createType: 1 }, httpFields())).toThrow('脚本');
		expect(() => jobPayload({ jobId: 'http', createType: 2, properties: '[]' }, { uri: 'https://test', method: 'GET', body: '' })).toThrow('JSON');
		expect(() => jobPayload({ jobId: 'http', createType: 2 }, { uri: 'file:///test', method: 'GET', body: '' })).toThrow('http');
	});
	it('preserves explicit HTTP failure policy instead of enabling it on unrelated edits', () => {
		const properties = JSON.stringify({ HttpJob: JSON.stringify({ RequestUri: 'https://test', EnsureSuccessStatusCode: false }) });
		const payload = jobPayload(jobDraft({ jobId: 'http', createType: 2, properties }), httpFields(properties));
		expect(JSON.parse(JSON.parse(payload.properties!).HttpJob).EnsureSuccessStatusCode).toBe(false);
	});
	it('preserves custom non-cron triggers and scheduling controls', () => {
		const draft = triggerDraft('job', {
			jobId: 'job',
			triggerId: 'custom',
			triggerType: 'Existing.CustomTrigger',
			assemblyName: 'Existing',
			args: '1,"value"',
			startNow: false,
			runOnStart: true,
			resetOnlyOnce: false,
			maxNumberOfRuns: 5,
			maxNumberOfErrors: 2,
			numRetries: 3,
			retryTimeout: 600,
		});
		expect(draft).toMatchObject({
			triggerId: 'custom',
			args: '1,"value"',
			triggerType: 'Existing.CustomTrigger',
			startNow: false,
			runOnStart: true,
			resetOnlyOnce: false,
			maxNumberOfRuns: 5,
			maxNumberOfErrors: 2,
			numRetries: 3,
			retryTimeout: 600,
		});
	});
	it('retains server wall-clock time without adding an inferred browser offset', () => {
		expect(wallTime('2026-10-09 12:30:59')).toBe('2026-10-09T12:30:59');
	});
});
