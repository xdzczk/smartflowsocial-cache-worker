/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { afterEach, describe, expect, it, vi } from 'vitest';

import { queryNativeNostrMash } from '../src/native-nostrmash';

const BASE = 'https://cache.example';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('queryNativeNostrMash', () => {
	it('returns null for request types that cannot be translated faithfully', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const messages = await queryNativeNostrMash(BASE, 'event_actions', { kind: 7 }, 'trace');
		expect(messages).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null when the pubkey is not 64-char hex', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const messages = await queryNativeNostrMash(
			BASE,
			'user_profile',
			{ pubkey: 'npub1example' },
			'trace',
		);
		expect(messages).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('wraps a profile batch as kind 0 events and keeps the requested pubkey casing', async () => {
		const pubkey = 'A'.repeat(64);
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					Response.json({
						profiles: [
							{
								pubkey: pubkey.toLowerCase(),
								metadata_event_id: 'b'.repeat(64),
								metadata_created_at: 3,
								profile: { display_name: 'Ada' },
							},
						],
						missing_pubkeys: [],
					}),
				),
			),
		);
		const messages = await queryNativeNostrMash(BASE, 'user_infos', { pubkeys: [pubkey] }, 'trace');
		expect(messages).not.toBeNull();
		const event = (messages ?? []).find(
			(message) => Array.isArray(message) && message[0] === 'EVENT',
		);
		if (!Array.isArray(event)) throw new Error('missing event');
		const row = event as unknown[];
		const raw = row[2];
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('missing body');
		const body = raw as { kind: number; pubkey: string; content: string };
		expect(body.kind).toBe(0);
		expect(body.pubkey).toBe(pubkey);
		expect(JSON.parse(body.content)).toMatchObject({ display_name: 'Ada' });
	});

	it('wraps canonical events from the batch route', async () => {
		const eventId = 'c'.repeat(64);
		vi.stubGlobal(
			'fetch',
			vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
				expect(init?.method).toBe('POST');
				const raw = init?.body;
				if (typeof raw !== 'string') throw new Error('expected string body');
				const payload = JSON.parse(raw) as { ids?: unknown };
				expect(payload.ids).toEqual([eventId]);
				return Promise.resolve(
					Response.json({
						events: [{ id: eventId, kind: 1, content: 'note', pubkey: 'd'.repeat(64) }],
						missing: [],
					}),
				);
			}),
		);
		const messages = await queryNativeNostrMash(BASE, 'events', { event_ids: [eventId] }, 'trace');
		const event = (messages ?? []).find(
			(message) => Array.isArray(message) && message[0] === 'EVENT',
		) as unknown[];
		expect(event[2]).toMatchObject({ id: eventId, kind: 1, content: 'note' });
	});
});
