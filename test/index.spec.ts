/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/index';
import { MockPrimalWebSocket } from './mock-primal-websocket';

describe('Primal cache worker', () => {
	beforeEach(() => {
		MockPrimalWebSocket.instances = [];
		MockPrimalWebSocket.recordedSends = [];
		MockPrimalWebSocket.scenario = 'success';
		MockPrimalWebSocket.scenarioByUrl = null;
		vi.stubGlobal('WebSocket', MockPrimalWebSocket);
	});

	afterEach(() => {
		MockPrimalWebSocket.scenarioByUrl = null;
		vi.unstubAllGlobals();
	});

	it('handles OPTIONS with CORS headers', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', { method: 'OPTIONS' }),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('X-Request-Id')).toBeTruthy();
	});

	it('returns 405 for non-POST', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(new Request('http://example.com'), env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(405);
		const json: { error?: string } = await response.json();
		expect(json.error).toBe('Method not allowed');
	});

	it('returns 400 when requestType is missing', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
		const json: { error?: string } = await response.json();
		expect(json.error).toContain('requestType');
	});

	it('returns 400 for invalid JSON body', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{ not json',
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
		const json: { error?: string } = await response.json();
		expect(json.error).toBe('Invalid JSON body');
	});

	it('returns 413 when body exceeds limit', async () => {
		const ctx = createExecutionContext();
		const padding = 'x'.repeat(300_000);
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats', padding }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(413);
		const json: { error?: string } = await response.json();
		expect(json.error).toBe('Request body too large');
	});

	it('returns 400 for invalid requestType (fail fast)', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'not_a_real_primal_type' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
		const json: { error?: string } = await response.json();
		expect(json.error).toContain('Invalid request type');
		expect(MockPrimalWebSocket.instances.length).toBe(0);
	});

	it('returns 200 and Primal-shaped JSON for a valid no-params request', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(Array.isArray(data)).toBe(true);
		expect((data as unknown[]).some((m) => Array.isArray(m) && m[0] === 'EOSE')).toBe(true);
	});

	it('returns 502 when upstream sends NOTICE error on all endpoints', async () => {
		MockPrimalWebSocket.scenario = 'notice_error';
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(502);
		const json: { error?: string } = await response.json();
		expect(json.error).toBe('All websocket endpoints failed');
	});

	it('returns 502 when upstream sends EOSE with no EVENT', async () => {
		MockPrimalWebSocket.scenario = 'eose_only';
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(502);
	});

	it('returns 502 when upstream sends a non-text frame', async () => {
		MockPrimalWebSocket.scenario = 'binary_frame';
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(502);
	});

	it('echoes X-Request-Id when provided', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Request-Id': 'client-trace-123',
				},
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.headers.get('X-Request-Id')).toBe('client-trace-123');
	});

	it('returns 400 for strict schema when extra top-level keys are present', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					requestType: 'network_stats',
					extraKey: true,
				}),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
		const json: { error?: string } = await response.json();
		expect(json.error).toMatch(/unrecognized|Unrecognized|strict/i);
	});

	it('returns 400 when requestType is empty string', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: '' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
		const json: { error?: string } = await response.json();
		expect(json.error).toContain('requestType');
	});

	it('returns 413 when Content-Length exceeds limit before reading body', async () => {
		const ctx = createExecutionContext();
		const smallBody = JSON.stringify({ requestType: 'network_stats' });
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': String(400_000),
				},
				body: smallBody,
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(413);
	});

	it('ignores X-Request-Id longer than 128 chars and generates an id', async () => {
		const longId = 'x'.repeat(129);
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Request-Id': longId,
				},
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		const echoed = response.headers.get('X-Request-Id');
		expect(echoed).not.toBe(longId);
		expect(echoed).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
	});

	it('ignores whitespace-only X-Request-Id and generates an id', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Request-Id': '   ',
				},
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		const echoed = response.headers.get('X-Request-Id');
		expect(echoed).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
	});

	it('sends no-params wire shape for network_stats', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(MockPrimalWebSocket.recordedSends.length).toBeGreaterThanOrEqual(1);
		const wire = JSON.parse(MockPrimalWebSocket.recordedSends[0]!) as unknown[];
		expect(wire[0]).toBe('REQ');
		expect(typeof wire[1]).toBe('string');
		const payload = wire[2] as { cache?: unknown[] };
		expect(payload.cache).toEqual(['network_stats']);
	});

	it('sends params wire shape for feed', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					requestType: 'feed',
					params: { limit: 7, pubkey: 'abc' },
				}),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const wire = JSON.parse(MockPrimalWebSocket.recordedSends[0]!) as unknown[];
		const payload = wire[2] as { cache?: unknown[] };
		expect(payload.cache?.[0]).toBe('feed');
		expect(payload.cache?.[1]).toEqual({ limit: 7, pubkey: 'abc' });
	});

	it('succeeds after failover when the third endpoint responds', async () => {
		MockPrimalWebSocket.scenarioByUrl = (url) => {
			if (url.includes('cache2.primal.net')) return 'success';
			return 'notice_error';
		};
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(MockPrimalWebSocket.instances.length).toBe(3);
	});

	it('returns 504 when every endpoint hits connect timeout', { timeout: 15_000 }, async () => {
		MockPrimalWebSocket.scenario = 'connect_never';
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(504);
		const json: { error?: string } = await response.json();
		expect(json.error).toBe('All websocket endpoints failed');
	});

	it('returns 502 when upstream sends invalid JSON in a text frame', async () => {
		MockPrimalWebSocket.scenario = 'invalid_json_message';
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(502);
	});

	it('returns 502 when upstream sends JSON object instead of array', async () => {
		MockPrimalWebSocket.scenario = 'json_object_message';
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(502);
	});
});
