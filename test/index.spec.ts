/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/index';
import { MockPrimalWebSocket } from './mock-primal-websocket';

describe('Primal cache worker', () => {
	beforeEach(() => {
		MockPrimalWebSocket.instances = [];
		MockPrimalWebSocket.scenario = 'success';
		vi.stubGlobal('WebSocket', MockPrimalWebSocket);
	});

	afterEach(() => {
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
});
