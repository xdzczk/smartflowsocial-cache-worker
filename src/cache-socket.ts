import { isNoticeError, wireCommand } from './frames';
import { WorkerHttpError } from './http-error';
import { NO_PARAMS_TYPES } from './request-types';

const CONNECT_TIMEOUT_MS = 3000;
const RESPONSE_TIMEOUT_MS = 5000;

function subscriptionId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function queryCacheSocket(
	endpoint: string,
	requestType: string,
	params: Record<string, unknown> | undefined,
	traceId: string,
): Promise<unknown[]> {
	const wsRequestId = subscriptionId();
	const startedAt = Date.now();
	console.log('Cache socket attempt started', { traceId, requestType, endpoint });

	return new Promise<unknown[]>((resolve, reject) => {
		const ws = new WebSocket(endpoint);
		const responses: unknown[] = [];

		let settled = false;
		let opened = false;
		let connectTimer: ReturnType<typeof setTimeout> | null = null;
		let responseTimer: ReturnType<typeof setTimeout> | null = null;

		const cleanup = () => {
			if (connectTimer) clearTimeout(connectTimer);
			if (responseTimer) clearTimeout(responseTimer);
			try {
				ws.close();
			} catch {
				/* ignore close errors */
			}
		};

		const failHttp = (status: 502 | 504, message: string) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(new WorkerHttpError(status, message, traceId));
		};

		const succeed = (value: unknown[]) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};

		connectTimer = setTimeout(() => {
			console.warn('Cache socket connect timeout', { traceId, requestType, endpoint });
			failHttp(504, `WebSocket connect timeout to ${endpoint}`);
		}, CONNECT_TIMEOUT_MS);

		ws.addEventListener('open', () => {
			opened = true;
			if (connectTimer) clearTimeout(connectTimer);

			console.log('Cache socket opened', { traceId, requestType, endpoint });

			responseTimer = setTimeout(() => {
				console.warn('Cache socket response timeout', { traceId, requestType, endpoint });
				failHttp(504, `WebSocket response timeout waiting for EOSE from ${endpoint}`);
			}, RESPONSE_TIMEOUT_MS);

			const cacheRequest: unknown = NO_PARAMS_TYPES.has(requestType)
				? ['REQ', wsRequestId, { cache: [requestType] }]
				: ['REQ', wsRequestId, { cache: [requestType, params ?? {}] }];

			try {
				ws.send(JSON.stringify(cacheRequest));
			} catch (err) {
				failHttp(502, err instanceof Error ? err.message : 'WebSocket send failed');
			}
		});

		ws.addEventListener('message', (event: MessageEvent) => {
			const raw: unknown = event.data;
			if (typeof raw !== 'string') {
				console.error('Cache socket non-text frame', { traceId, requestType, endpoint });
				failHttp(502, `Non-text WebSocket frame from ${endpoint}`);
				return;
			}

			let data: unknown;
			try {
				data = JSON.parse(raw) as unknown;
			} catch {
				console.error('Cache socket invalid JSON', { traceId, requestType, endpoint });
				failHttp(502, `Invalid JSON from ${endpoint}`);
				return;
			}

			if (!Array.isArray(data)) {
				failHttp(502, `Unexpected JSON shape from ${endpoint}`);
				return;
			}

			responses.push(data);

			if (isNoticeError(data)) {
				console.warn('Cache socket NOTICE error', { traceId, requestType, endpoint });
				failHttp(502, `Received NOTICE error from ${endpoint}`);
				return;
			}

			if (wireCommand(data) === 'EOSE') {
				const hasData = responses.some(
					(row) => wireCommand(row) !== 'EOSE' && wireCommand(row) !== 'NOTICE',
				);
				if (!hasData) {
					failHttp(502, `No data returned from ${endpoint}`);
					return;
				}

				console.log('Cache socket success', {
					traceId,
					requestType,
					endpoint,
					durationMs: Date.now() - startedAt,
					messageCount: responses.length,
				});

				succeed(responses);
			}
		});

		ws.addEventListener('error', () => {
			console.warn('Cache socket websocket error', { traceId, requestType, endpoint });
			failHttp(502, `WebSocket error from ${endpoint}`);
		});

		ws.addEventListener('close', () => {
			if (!settled) {
				console.warn('Cache socket closed before completion', {
					traceId,
					requestType,
					endpoint,
					opened,
				});
				failHttp(502, `WebSocket closed before completion from ${endpoint}`);
			}
		});
	});
}
