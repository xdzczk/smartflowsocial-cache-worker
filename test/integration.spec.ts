/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockPrimalWebSocket } from './mock-primal-websocket';

describe('Primal cache worker (integration)', () => {
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

	it('exports.default.fetch returns 200 for valid request', async () => {
		const response = await workerExports.default.fetch(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'network_stats' }),
			}),
		);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(Array.isArray(data)).toBe(true);
	});

	it('exports.default.fetch returns 400 for invalid requestType', async () => {
		const response = await workerExports.default.fetch(
			new Request('http://example.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestType: 'invalid_type_xyz' }),
			}),
		);
		expect(response.status).toBe(400);
	});
});
