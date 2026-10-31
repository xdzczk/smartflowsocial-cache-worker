import { postBodySchema } from './body-schema';
import { queryCacheSocket } from './cache-socket';
import { isUsableCachePayload } from './frames';
import type { CacheSource } from './frames';
import { WorkerHttpError } from './http-error';
import { queryNativeNostrMash } from './native-nostrmash';

const MAX_BODY_BYTES = 256 * 1024;

const DEFAULT_NOSTRMASH_HTTP = 'https://api.nostrmash.com';
const DEFAULT_NOSTRMASH_WS = 'wss://api.nostrmash.com/primal/ws/v1';

const PRIMAL_WS_ENDPOINTS = [
	'wss://cache.smartflowsocial.com/v1',
	'wss://cache1.primal.net/v1',
	'wss://cache2.primal.net/v1',
] as const;

function nostrmashHttpBase(env: Env): string {
	const configured = env.NOSTRMASH_HTTP_BASE?.trim();
	return configured && configured.length > 0 ? configured : DEFAULT_NOSTRMASH_HTTP;
}

function nostrmashWsUrl(env: Env): string {
	const configured = env.NOSTRMASH_WS_URL?.trim();
	return configured && configured.length > 0 ? configured : DEFAULT_NOSTRMASH_WS;
}

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
		'Access-Control-Expose-Headers': 'X-Request-Id, X-Cache-Source',
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

async function loadCache(
	env: Env,
	requestType: string,
	params: Record<string, unknown> | undefined,
	traceId: string,
	skipNative: boolean,
): Promise<{ messages: unknown[]; source: CacheSource }> {
	const startedAt = Date.now();
	const httpBase = nostrmashHttpBase(env);
	if (skipNative) {
		console.log('Skipping NostrMash native tier', { traceId, requestType });
	}
	try {
		const native = skipNative
			? null
			: await queryNativeNostrMash(httpBase, requestType, params, traceId);
		if (native && isUsableCachePayload(requestType, params, native)) {
			console.log('Cache upstream selected', {
				traceId,
				requestType,
				source: 'nostrmash-native',
				durationMs: Date.now() - startedAt,
			});
			return { messages: native, source: 'nostrmash-native' };
		}
	} catch (err) {
		console.warn('NostrMash native lookup failed', {
			traceId,
			requestType,
			error: err instanceof Error ? err.message : String(err),
		});
	}

	const endpoints = [nostrmashWsUrl(env), ...PRIMAL_WS_ENDPOINTS];
	const failures: WorkerHttpError[] = [];

	for (const endpoint of endpoints) {
		try {
			const messages = await queryCacheSocket(endpoint, requestType, params, traceId);
			if (!isUsableCachePayload(requestType, params, messages)) {
				console.warn('Cache payload not usable for this request, trying next', {
					traceId,
					requestType,
					endpoint,
				});
				failures.push(new WorkerHttpError(502, `Unusable payload from ${endpoint}`, traceId));
				continue;
			}
			const source: CacheSource = endpoint === nostrmashWsUrl(env) ? 'nostrmash-ws' : 'primal';
			console.log('Cache upstream selected', {
				traceId,
				requestType,
				source,
				endpoint,
				durationMs: Date.now() - startedAt,
			});
			return { messages, source };
		} catch (err) {
			const httpErr =
				err instanceof WorkerHttpError
					? err
					: new WorkerHttpError(502, err instanceof Error ? err.message : String(err), traceId);
			failures.push(httpErr);
			console.warn('Cache endpoint failed, trying next', {
				traceId,
				requestType,
				endpoint,
				status: httpErr.status,
				error: httpErr.message,
			});
		}
	}

	const allTimeouts = failures.length > 0 && failures.every((failure) => failure.status === 504);
	const status = allTimeouts ? 504 : 502;
	console.error('Cache upstreams failed', {
		traceId,
		requestType,
		failures: failures.length,
	});
	throw new WorkerHttpError(status, 'All websocket endpoints failed', traceId);
}

const handler: ExportedHandler<Env> = {
	async fetch(request, env): Promise<Response> {
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
			const skipNative = request.headers.get('x-cache-skip-native') === '1';
			const { messages, source } = await loadCache(env, requestType, params, traceId, skipNative);

			return new Response(JSON.stringify(messages), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'X-Cache-Source': source,
					...corsHeaders(traceId),
				},
			});
		} catch (error) {
			if (error instanceof WorkerHttpError) {
				console.error('Cache request failed', {
					traceId: error.traceId,
					status: error.status,
					error: error.message,
				});
				return jsonResponse(error.traceId, error.status, { error: error.message });
			}

			console.error('Cache request failed', {
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
