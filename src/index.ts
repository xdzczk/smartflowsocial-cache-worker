import { postBodySchema } from './body-schema';
import { WorkerHttpError } from './http-error';
import { NO_PARAMS_TYPES } from './request-types';

const MAX_BODY_BYTES = 256 * 1024;

const WS_ENDPOINTS = [
	'wss://cache.smartflowsocial.com/v1',
	'wss://cache1.primal.net/v1',
	'wss://cache2.primal.net/v1',
] as const;

const CONNECT_TIMEOUT_MS = 3000;
const RESPONSE_TIMEOUT_MS = 5000;

function getTraceId(request: Request): string {
	const raw = request.headers.get('x-request-id')?.trim();
	if (raw && raw.length > 0 && raw.length <= 128) {
		return raw;
	}
	return crypto.randomUUID();
}

function corsHeaders(traceId: string): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, X-Request-Id',
		'Access-Control-Expose-Headers': 'X-Request-Id',
		'X-Request-Id': traceId,
	};
}

function jsonResponse(traceId: string, status: number, payload: Record<string, unknown>): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders(traceId),
		},
	});
}

async function readBodyWithLimit(
	request: Request,
	maxBytes: number,
	traceId: string,
): Promise<ArrayBuffer> {
	const cl = request.headers.get('content-length');
	if (cl !== null) {
		const n = Number(cl);
		if (Number.isFinite(n) && n > maxBytes) {
			throw new WorkerHttpError(413, 'Request body too large', traceId);
		}
	}
	const buf = await request.arrayBuffer();
	if (buf.byteLength > maxBytes) {
		throw new WorkerHttpError(413, 'Request body too large', traceId);
	}
	return buf;
}

function wireCommand(msg: unknown): string | undefined {
	if (!Array.isArray(msg) || msg.length < 1) return undefined;
	const row = msg as unknown[];
	const cmd = row[0];
	return typeof cmd === 'string' ? cmd : undefined;
}

function isNoticeError(msg: unknown): boolean {
	if (!Array.isArray(msg) || msg.length < 3) return false;
	const row = msg as unknown[];
	return row[0] === 'NOTICE' && row[2] === 'error';
}

async function connectToPrimalCache(
	requestType: string,
	params: Record<string, unknown> | undefined,
	traceId: string,
): Promise<unknown[]> {
	const failures: WorkerHttpError[] = [];

	for (let i = 0; i < WS_ENDPOINTS.length; i++) {
		const endpoint = WS_ENDPOINTS[i]!;
		const wsRequestId = Math.random().toString(36).substring(2, 12);

		try {
			const startedAt = Date.now();
			console.log('Primal cache attempt started', { traceId, requestType, endpoint });

			const result = await new Promise<unknown[]>((resolve, reject) => {
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
					console.warn('Primal cache connect timeout', { traceId, requestType, endpoint });
					failHttp(504, `WebSocket connect timeout to ${endpoint}`);
				}, CONNECT_TIMEOUT_MS);

				ws.addEventListener('open', () => {
					opened = true;
					if (connectTimer) clearTimeout(connectTimer);

					console.log('Primal cache socket opened', { traceId, requestType, endpoint });

					responseTimer = setTimeout(() => {
						console.warn('Primal cache response timeout', { traceId, requestType, endpoint });
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
						console.error('Primal cache non-text frame', { traceId, requestType, endpoint });
						failHttp(502, `Non-text WebSocket frame from ${endpoint}`);
						return;
					}

					let data: unknown;
					try {
						data = JSON.parse(raw) as unknown;
					} catch {
						console.error('Primal cache invalid JSON', { traceId, requestType, endpoint });
						failHttp(502, `Invalid JSON from ${endpoint}`);
						return;
					}

					if (!Array.isArray(data)) {
						failHttp(502, `Unexpected JSON shape from ${endpoint}`);
						return;
					}

					responses.push(data);

					if (isNoticeError(data)) {
						console.warn('Primal cache NOTICE error', { traceId, requestType, endpoint });
						failHttp(502, `Received NOTICE error from ${endpoint}`);
						return;
					}

					if (wireCommand(data) === 'EOSE') {
						const hasData = responses.some(
							(r) => wireCommand(r) !== 'EOSE' && wireCommand(r) !== 'NOTICE',
						);
						if (!hasData) {
							failHttp(502, `No data returned from ${endpoint}`);
							return;
						}

						console.log('Primal cache success', {
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
					console.warn('Primal cache websocket error', { traceId, requestType, endpoint });
					failHttp(502, `WebSocket error from ${endpoint}`);
				});

				ws.addEventListener('close', () => {
					if (!settled) {
						console.warn('Primal cache socket closed before completion', {
							traceId,
							requestType,
							endpoint,
							opened,
						});
						failHttp(502, `WebSocket closed before completion from ${endpoint}`);
					}
				});
			});

			return result;
		} catch (err) {
			const httpErr =
				err instanceof WorkerHttpError
					? err
					: new WorkerHttpError(502, err instanceof Error ? err.message : String(err), traceId);
			failures.push(httpErr);
			console.warn('Primal cache endpoint failed, trying next', {
				traceId,
				requestType,
				endpoint,
				status: httpErr.status,
				error: httpErr.message,
			});
		}
	}

	const allTimeouts = failures.length > 0 && failures.every((e) => e.status === 504);
	const status = allTimeouts ? 504 : 502;
	console.error('Primal cache all endpoints failed', {
		traceId,
		requestType,
		failures: failures.length,
	});
	throw new WorkerHttpError(status, 'All websocket endpoints failed', traceId);
}

const handler: ExportedHandler<Env> = {
	async fetch(request): Promise<Response> {
		const traceId = getTraceId(request);

		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: corsHeaders(traceId),
			});
		}

		if (request.method !== 'POST') {
			return jsonResponse(traceId, 405, { error: 'Method not allowed' });
		}

		try {
			const rawBody = await readBodyWithLimit(request, MAX_BODY_BYTES, traceId);
			const text = new TextDecoder().decode(rawBody);

			let parsed: unknown;
			try {
				parsed = text.length === 0 ? null : (JSON.parse(text) as unknown);
			} catch {
				throw new WorkerHttpError(400, 'Invalid JSON body', traceId);
			}

			const bodyResult = postBodySchema.safeParse(parsed);
			if (!bodyResult.success) {
				const msg = bodyResult.error.issues.map((issue) => issue.message).join('; ');
				throw new WorkerHttpError(400, msg, traceId);
			}

			const { requestType, params } = bodyResult.data;

			const data = await connectToPrimalCache(requestType, params, traceId);

			return new Response(JSON.stringify(data), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					...corsHeaders(traceId),
				},
			});
		} catch (error) {
			if (error instanceof WorkerHttpError) {
				console.error('Primal cache request failed', {
					traceId: error.traceId,
					status: error.status,
					error: error.message,
				});
				return jsonResponse(error.traceId, error.status, { error: error.message });
			}

			console.error('Primal cache request failed', {
				traceId,
				error: error instanceof Error ? error.message : String(error),
			});
			return jsonResponse(traceId, 500, {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	},
};

export default handler;
