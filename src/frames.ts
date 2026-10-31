const HEX_64 = /^[0-9a-f]{64}$/i;

export type CacheSource = 'nostrmash-native' | 'nostrmash-ws' | 'primal';

function asRow(msg: unknown): unknown[] | null {
	if (!Array.isArray(msg)) return null;
	return msg as unknown[];
}

export function wireCommand(msg: unknown): string | undefined {
	const row = asRow(msg);
	if (!row || row.length < 1) return undefined;
	const cmd = row[0];
	return typeof cmd === 'string' ? cmd : undefined;
}

export function isNoticeError(msg: unknown): boolean {
	const row = asRow(msg);
	if (!row || row.length < 3) return false;
	return row[0] === 'NOTICE' && row[2] === 'error';
}

export function eventFrame(subId: string, event: Record<string, unknown>): unknown[] {
	return ['EVENT', subId, event];
}

export function eoseFrame(subId: string): unknown[] {
	return ['EOSE', subId];
}

/** 64-char hex, keeping the caller's casing so downstream pubkey maps still match. */
export function hex64(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return HEX_64.test(trimmed) ? trimmed : null;
}

export function hexList(value: unknown, max: number): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const hex = hex64(item);
		if (!hex) continue;
		const key = hex.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(hex);
		if (out.length >= max) break;
	}
	return out;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

export function field(record: Record<string, unknown> | null | undefined, key: string): unknown {
	if (!record) return undefined;
	return record[key];
}

export function num(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function kindContentEvent(
	kind: number,
	content: unknown,
	extra?: Record<string, unknown>,
): Record<string, unknown> {
	const event: Record<string, unknown> = {
		id: '',
		pubkey: '',
		created_at: 0,
		kind,
		tags: [],
		content: typeof content === 'string' ? content : JSON.stringify(content),
		sig: '',
	};
	if (extra) {
		for (const [key, value] of Object.entries(extra)) {
			event[key] = value;
		}
	}
	return event;
}

function eventRecord(message: unknown): Record<string, unknown> | null {
	const row = asRow(message);
	if (!row || row[0] !== 'EVENT') return null;
	return asRecord(row[2]);
}

export function eventKind(message: unknown): number | undefined {
	const kind = field(eventRecord(message), 'kind');
	return typeof kind === 'number' ? kind : undefined;
}

/**
 * SmartFlowSocial only treats a cache page as data when it contains events it
 * can parse. `event_actions` must include the requested kind (likes, reposts,
 * replies, zaps). NostrMash's compatibility handler answers that call with
 * profile events, which would look successful and hide the real reactions.
 */
export function isUsableCachePayload(
	requestType: string,
	params: Record<string, unknown> | undefined,
	messages: unknown[],
): boolean {
	const payload = messages.some((message) => {
		const cmd = wireCommand(message);
		return cmd !== undefined && cmd !== 'EOSE' && cmd !== 'NOTICE';
	});
	if (!payload) return false;
	if (requestType !== 'event_actions') return true;
	const kind = field(params, 'kind');
	if (typeof kind !== 'number') return true;
	return messages.some((message) => eventKind(message) === kind);
}
