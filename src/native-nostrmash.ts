import { asRecord, eoseFrame, eventFrame, hex64, hexList, kindContentEvent, num } from './frames';

const SIMPLE_TIMEOUT_MS = 2000;
const THREAD_TIMEOUT_MS = 2500;
const MAX_NATIVE_BYTES = 2 * 1024 * 1024;
const MAX_BATCH = 100;
const MAX_COUNT_LOOKUPS = 20;

function nativeSubId(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	return `nm${suffix}`;
}

function bounded(value: unknown, fallback: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
	return Math.min(max, Math.floor(value));
}

function profileContent(profile: unknown): string | null {
	if (typeof profile === 'string') {
		const trimmed = profile.trim();
		if (!trimmed || trimmed === 'null' || trimmed === '{}') return null;
		return trimmed;
	}
	const record = asRecord(profile);
	if (!record || Object.keys(record).length === 0) return null;
	return JSON.stringify(record);
}

function kind0Event(
	pubkey: string,
	profile: unknown,
	metadataEventId: unknown,
	createdAt: unknown,
): Record<string, unknown> | null {
	const content = profileContent(profile);
	if (!content) return null;
	const id = typeof metadataEventId === 'string' ? metadataEventId : '';
	return kindContentEvent(0, content, {
		id,
		pubkey,
		created_at: num(createdAt),
	});
}

function userStatsEvent(pubkey: string, stats: Record<string, unknown>): Record<string, unknown> {
	return kindContentEvent(
		10000105,
		{
			pubkey,
			follows_count: num(stats['following_count']),
			followers_count: num(stats['follower_count']),
			note_count: num(stats['note_count']),
			long_form_note_count: num(stats['long_form_note_count']),
			reply_count: num(stats['reply_count']),
			time_joined: num(stats['time_joined']),
			relay_count: 0,
			total_zap_count: num(stats['zap_received_count']),
			total_satszapped: num(stats['sats_zapped']),
			media_count: num(stats['media_count']),
			content_zap_count: num(stats['content_zap_count']),
		},
		{ pubkey },
	);
}

function noteStatsEvent(eventId: string, counts: Record<string, unknown>): Record<string, unknown> {
	return kindContentEvent(10000100, {
		event_id: eventId,
		likes: num(counts['reaction_count']),
		replies: num(counts['reply_count']),
		mentions: 0,
		reposts: num(counts['repost_count']),
		zaps: num(counts['zap_count']),
		satszapped: Math.floor(num(counts['zap_msats']) / 1000),
		score: 0,
		score24h: 0,
		bookmarks: 0,
	});
}

function statsArePresent(stats: Record<string, unknown> | null): boolean {
	if (!stats) return false;
	return (
		num(stats['follower_count']) > 0 ||
		num(stats['following_count']) > 0 ||
		num(stats['note_count']) > 0 ||
		num(stats['reply_count']) > 0 ||
		num(stats['zap_received_count']) > 0 ||
		num(stats['sats_zapped']) > 0 ||
		num(stats['media_count']) > 0 ||
		num(stats['long_form_note_count']) > 0
	);
}

function nostrEvent(value: unknown): Record<string, unknown> | null {
	if (typeof value === 'string') {
		try {
			return nostrEvent(JSON.parse(value) as unknown);
		} catch {
			return null;
		}
	}
	const record = asRecord(value);
	if (!record) return null;
	if (typeof record['kind'] === 'number' || typeof record['id'] === 'string') return record;
	return null;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

interface NativeResponse {
	status: number;
	body: unknown;
}

async function readNative(
	url: string,
	traceId: string,
	signal: AbortSignal,
	init?: RequestInit,
): Promise<NativeResponse | null> {
	try {
		const response = await fetch(url, {
			...init,
			signal,
			headers: {
				Accept: 'application/json',
				'X-Request-Id': traceId,
				...init?.headers,
			},
		});
		const declared = response.headers.get('content-length');
		if (declared !== null) {
			const size = Number(declared);
			if (Number.isFinite(size) && size > MAX_NATIVE_BYTES) return null;
		}
		const text = await response.text();
		if (text.length > MAX_NATIVE_BYTES) return null;
		let body: unknown = null;
		if (text.length > 0) {
			try {
				body = JSON.parse(text) as unknown;
			} catch {
				body = null;
			}
		}
		return { status: response.status, body };
	} catch (err) {
		console.warn('NostrMash native request failed', {
			traceId,
			url,
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

function finish(subId: string, events: Record<string, unknown>[]): unknown[] | null {
	if (events.length === 0) return null;
	return [...events.map((event) => eventFrame(subId, event)), eoseFrame(subId)];
}

async function queryUserProfile(
	base: string,
	params: Record<string, unknown> | undefined,
	traceId: string,
): Promise<unknown[] | null> {
	const pubkey = hex64(params?.['pubkey']);
	if (!pubkey) return null;
	const signal = AbortSignal.timeout(SIMPLE_TIMEOUT_MS);
	const response = await readNative(
		`${base}/api/v1/users/${encodeURIComponent(pubkey)}/summary`,
		traceId,
		signal,
	);
	if (!response || response.status !== 200) return null;
	const body = asRecord(response.body);
	if (!body) return null;
	const stats = asRecord(body['stats']);
	const profile = kind0Event(
		pubkey,
		body['profile'],
		body['metadata_event_id'],
		body['metadata_created_at'],
	);
	if (!profile && !statsArePresent(stats)) return null;
	const events: Record<string, unknown>[] = [];
	if (profile) events.push(profile);
	if (stats) events.push(userStatsEvent(pubkey, stats));
	return finish(nativeSubId(), events);
}

async function queryUserInfos(
	base: string,
	params: Record<string, unknown> | undefined,
	traceId: string,
): Promise<unknown[] | null> {
	const pubkeys = hexList(params?.['pubkeys'], MAX_BATCH);
	if (pubkeys.length === 0) return null;
	const signal = AbortSignal.timeout(SIMPLE_TIMEOUT_MS);
	const response = await readNative(`${base}/api/v1/profiles/batch`, traceId, signal, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ pubkeys }),
	});
	if (!response || response.status !== 200) return null;
	const rows = asArray(asRecord(response.body)?.['profiles']);
	const events: Record<string, unknown>[] = [];
	for (const row of rows) {
		const record = asRecord(row);
		if (!record) continue;
		const pubkey = hex64(record['pubkey']);
		if (!pubkey) continue;
		const requested = pubkeys.find((item) => item.toLowerCase() === pubkey.toLowerCase()) ?? pubkey;
		const profile = kind0Event(
			requested,
			record['profile'],
			record['metadata_event_id'],
			record['metadata_created_at'],
		);
		if (profile) events.push(profile);
	}
	return finish(nativeSubId(), events);
}

async function queryEvents(
	base: string,
	params: Record<string, unknown> | undefined,
	traceId: string,
): Promise<unknown[] | null> {
	const ids = hexList(params?.['event_ids'], MAX_BATCH);
	if (ids.length === 0) return null;
	const signal = AbortSignal.timeout(SIMPLE_TIMEOUT_MS);
	const response = await readNative(`${base}/api/v1/events/batch`, traceId, signal, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ids }),
	});
	if (!response || response.status !== 200) return null;
	const events = asArray(asRecord(response.body)?.['events'])
		.map((item) => nostrEvent(item))
		.filter((event): event is Record<string, unknown> => event !== null);
	return finish(nativeSubId(), events);
}

function noteId(event: Record<string, unknown>): string | null {
	return hex64(event['id']);
}

async function queryThread(
	base: string,
	params: Record<string, unknown> | undefined,
	traceId: string,
): Promise<unknown[] | null> {
	const eventId = hex64(params?.['event_id']);
	if (!eventId) return null;
	const limit = bounded(params?.['limit'], 100, 100);
	const maxDepth = bounded(params?.['max_depth'], 100, 100);
	const signal = AbortSignal.timeout(THREAD_TIMEOUT_MS);
	const threadUrl = `${base}/api/v1/threads/${encodeURIComponent(eventId)}?limit=${limit}&max_depth=${maxDepth}`;
	const countsUrl = `${base}/api/v1/events/${encodeURIComponent(eventId)}/counts`;
	const [threadRes, countsRes] = await Promise.all([
		readNative(threadUrl, traceId, signal),
		readNative(countsUrl, traceId, signal),
	]);
	if (!threadRes || threadRes.status !== 200) return null;
	const focalCounts = countsRes?.status === 200 ? asRecord(countsRes.body) : null;
	if (!focalCounts) return null;
	// Native thread JSON is notes only. Zap receipts are on the v1 socket, and
	// giveaways read kind 9735 out of thread_view, so a zapped note must not
	// stop the fallback chain here.
	if (num(focalCounts['zap_count']) > 0) {
		console.log('NostrMash native thread skipped because the note has zap receipts', {
			traceId,
			eventId,
		});
		return null;
	}

	const body = asRecord(threadRes.body);
	if (!body) return null;
	const notes: Record<string, unknown>[] = [];
	const seen = new Set<string>();
	for (const item of [body['event'], ...asArray(body['ancestors']), ...asArray(body['replies'])]) {
		const event = nostrEvent(item);
		if (!event) continue;
		const id = noteId(event);
		if (id) {
			const key = id.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
		}
		notes.push(event);
	}
	const focalKey = eventId.toLowerCase();
	if (!seen.has(focalKey)) return null;

	const pubkeys = hexList(
		notes.map((event) => event['pubkey']),
		MAX_BATCH,
	);
	const extraIds = [...seen].filter((id) => id !== focalKey).slice(0, MAX_COUNT_LOOKUPS - 1);
	const [profileRes, ...countResponses] = await Promise.all([
		pubkeys.length === 0
			? Promise.resolve(null)
			: readNative(`${base}/api/v1/profiles/batch`, traceId, signal, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ pubkeys }),
				}),
		...extraIds.map((id) =>
			readNative(`${base}/api/v1/events/${encodeURIComponent(id)}/counts`, traceId, signal),
		),
	]);

	const events: Record<string, unknown>[] = [...notes];
	if (profileRes?.status === 200) {
		for (const row of asArray(asRecord(profileRes.body)?.['profiles'])) {
			const record = asRecord(row);
			if (!record) continue;
			const pubkey = hex64(record['pubkey']);
			if (!pubkey) continue;
			const profile = kind0Event(
				pubkey,
				record['profile'],
				record['metadata_event_id'],
				record['metadata_created_at'],
			);
			if (profile) events.push(profile);
		}
	}
	events.push(noteStatsEvent(eventId, focalCounts));
	for (const response of countResponses) {
		if (!response || response.status !== 200) continue;
		const counts = asRecord(response.body);
		const id = counts ? hex64(counts['event_id']) : null;
		if (!counts || !id) continue;
		events.push(noteStatsEvent(id, counts));
	}
	return finish(nativeSubId(), events);
}

/**
 * Translates NostrMash `/api/v1` reads into the Primal EVENT array SmartFlowSocial
 * already parses. Unmapped calls, misses, and transport failures return null so
 * the compatibility socket and then Primal can run.
 *
 * `event_actions` is intentionally unmapped: the native API does not return the
 * kind 6/7/9735 events giveaways collect. Mute lists are unmapped because the
 * native payload drops tag types.
 */
export async function queryNativeNostrMash(
	httpBase: string,
	requestType: string,
	params: Record<string, unknown> | undefined,
	traceId: string,
): Promise<unknown[] | null> {
	const base = httpBase.replace(/\/+$/, '');
	if (!base.startsWith('http://') && !base.startsWith('https://')) return null;

	switch (requestType) {
		case 'user_profile':
			return queryUserProfile(base, params, traceId);
		case 'user_infos':
			return queryUserInfos(base, params, traceId);
		case 'events':
			return queryEvents(base, params, traceId);
		case 'thread_view':
			return queryThread(base, params, traceId);
		default:
			return null;
	}
}
