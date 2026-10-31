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
		MockPrimalWebSocket.messagesByUrl = null;
		vi.stubGlobal('WebSocket', MockPrimalWebSocket);
	});

	afterEach(() => {
		MockPrimalWebSocket.scenarioByUrl = null;
		MockPrimalWebSocket.messagesByUrl = null;
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
		expect(response.headers.get('X-Cache-Source')).toBe('nostrmash-ws');
		expect(MockPrimalWebSocket.instances[0]?.url).toContain('/primal/ws/v1');
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
		expect(MockPrimalWebSocket.instances.length).toBe(4);
	});

	it('returns 504 when every endpoint hits connect timeout', { timeout: 20_000 }, async () => {
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

	it('serves user_profile from the native NostrMash API', async () => {
		const pubkey = 'a'.repeat(64);
		vi.stubGlobal(
			'fetch',
			vi.fn((input: RequestInfo | URL) => {
				const url = requestUrl(input);
				expect(url).toContain(`/api/v1/users/${pubkey}/summary`);
				return Promise.resolve(
					Response.json({
						pubkey,
						metadata_event_id: 'b'.repeat(64),
						metadata_created_at: 10,
						profile: { name: 'ada', display_name: 'Ada' },
						stats: {
							follower_count: 3,
							following_count: 4,
							note_count: 5,
							zap_received_count: 6,
							sats_zapped: 7,
						},
					}),
				);
			}),
		);

		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'user_profile', params: { pubkey } }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get('X-Cache-Source')).toBe('nostrmash-native');
		expect(MockPrimalWebSocket.instances.length).toBe(0);
		const data: unknown = await response.json();
		const kind0 = eventContent(data, 0);
		const stats = eventContent(data, 10000105);
		expect(kind0).toMatchObject({ name: 'ada', display_name: 'Ada' });
		expect(stats).toMatchObject({
			follows_count: 4,
			followers_count: 3,
			note_count: 5,
			total_zap_count: 6,
			total_satszapped: 7,
		});
	});

	it('skips the native tier when the app already tried NostrMash', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Cache-Skip-Native': '1',
				},
				body: JSON.stringify({
					requestType: 'user_profile',
					params: { pubkey: 'c'.repeat(64) },
				}),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get('X-Cache-Source')).toBe('nostrmash-ws');
		expect(fetchMock).not.toHaveBeenCalled();
		expect(MockPrimalWebSocket.instances[0]?.url).toContain('/primal/ws/v1');
	});

	it('falls through a native miss to the NostrMash compatibility socket', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 }),
				),
			),
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					requestType: 'user_profile',
					params: { pubkey: 'c'.repeat(64) },
				}),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get('X-Cache-Source')).toBe('nostrmash-ws');
		expect(MockPrimalWebSocket.instances.length).toBe(1);
		expect(MockPrimalWebSocket.instances[0]?.url).toContain('/primal/ws/v1');
	});

	it('skips a native thread that has zap receipts and uses the compatibility socket', async () => {
		const eventId = 'd'.repeat(64);
		vi.stubGlobal(
			'fetch',
			vi.fn((input: RequestInfo | URL) => {
				const url = requestUrl(input);
				if (url.includes('/counts')) {
					return Promise.resolve(
						Response.json({
							event_id: eventId,
							reply_count: 1,
							reaction_count: 0,
							repost_count: 0,
							zap_count: 2,
							zap_msats: 0,
						}),
					);
				}
				return Promise.resolve(
					Response.json({
						event: { id: eventId, kind: 1, pubkey: 'e'.repeat(64), content: 'hi', tags: [] },
						ancestors: [],
						replies: [],
					}),
				);
			}),
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'thread_view', params: { event_id: eventId } }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get('X-Cache-Source')).toBe('nostrmash-ws');
		expect(MockPrimalWebSocket.instances.length).toBe(1);
	});

	it('serves a zap-free thread from the native API', async () => {
		const eventId = 'f'.repeat(64);
		const pubkey = '1'.repeat(64);
		vi.stubGlobal(
			'fetch',
			vi.fn((input: RequestInfo | URL) => {
				const url = requestUrl(input);
				if (url.endsWith('/counts')) {
					return Promise.resolve(
						Response.json({
							event_id: eventId,
							reply_count: 0,
							reaction_count: 2,
							repost_count: 1,
							zap_count: 0,
							zap_msats: 0,
						}),
					);
				}
				if (url.includes('/profiles/batch')) {
					return Promise.resolve(
						Response.json({
							profiles: [
								{
									pubkey,
									metadata_event_id: '2'.repeat(64),
									metadata_created_at: 4,
									profile: { name: 'mina' },
								},
							],
							missing_pubkeys: [],
						}),
					);
				}
				return Promise.resolve(
					Response.json({
						event: {
							id: eventId,
							kind: 1,
							pubkey,
							content: 'hello',
							tags: [],
							created_at: 9,
						},
						ancestors: [],
						replies: [],
					}),
				);
			}),
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'thread_view', params: { event_id: eventId } }),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get('X-Cache-Source')).toBe('nostrmash-native');
		expect(MockPrimalWebSocket.instances.length).toBe(0);
		const data: unknown = await response.json();
		expect(eventContent(data, 1)).toMatchObject({ id: eventId, content: 'hello' });
		expect(eventContent(data, 0)).toMatchObject({ name: 'mina' });
		expect(eventContent(data, 10000100)).toMatchObject({
			event_id: eventId,
			likes: 2,
			reposts: 1,
			zaps: 0,
		});
	});

	it('does not accept NostrMash profile events as event_actions', async () => {
		const eventId = '9'.repeat(64);
		MockPrimalWebSocket.messagesByUrl = (url) => {
			if (url.includes('nostrmash')) {
				return [
					['EVENT', 'sub', { kind: 0, pubkey: 'a'.repeat(64), content: '{}' }],
					['EOSE', 'sub'],
				];
			}
			return [
				['EVENT', 'sub', { kind: 7, id: '8'.repeat(64), pubkey: 'a'.repeat(64) }],
				['EOSE', 'sub'],
			];
		};
		const ctx = createExecutionContext();
		const response = await worker.fetch!(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					requestType: 'event_actions',
					params: { event_id: eventId, kind: 7 },
				}),
			}),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get('X-Cache-Source')).toBe('primal');
		expect(MockPrimalWebSocket.instances.length).toBe(2);
		expect(MockPrimalWebSocket.instances[1]?.url).toContain('cache.smartflowsocial.com');
		const data: unknown = await response.json();
		expect(eventContent(data, 7)).toMatchObject({ kind: 7 });
	});
});

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === 'string') return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

function eventContent(messages: unknown, kind: number): Record<string, unknown> {
	if (!Array.isArray(messages)) throw new Error('expected array');
	for (const message of messages as unknown[]) {
		if (!Array.isArray(message)) continue;
		const row = message as unknown[];
		if (row[0] !== 'EVENT') continue;
		const event = row[2];
		if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
		const record = event as Record<string, unknown>;
		if (record['kind'] !== kind) continue;
		if (kind === 0 || kind === 10000105 || kind === 10000100) {
			if (typeof record['content'] !== 'string') throw new Error('expected string content');
			const parsed = JSON.parse(record['content']) as unknown;
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('expected object content');
			}
			return parsed as Record<string, unknown>;
		}
		return record;
	}
	throw new Error(`missing kind ${kind}`);
}
