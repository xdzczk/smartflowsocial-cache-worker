// Helper function to handle CORS
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

const WS_ENDPOINTS = [
	'wss://cache.smartflowsocial.com/v1',
	'wss://cache1.primal.net/v1',
	'wss://cache2.primal.net/v1',
];

const CONNECT_TIMEOUT_MS = 3000;
const RESPONSE_TIMEOUT_MS = 5000;

async function connectToPrimalCache(requestType, params) {
	for (let i = 0; i < WS_ENDPOINTS.length; i++) {
		const endpoint = WS_ENDPOINTS[i];
		const requestId = Math.random().toString(36).substring(2, 12);

		try {
			const startedAt = Date.now();
			console.log('Primal cache attempt started', { requestType, endpoint });

			const result = await new Promise((resolve, reject) => {
				const ws = new WebSocket(endpoint);
				const responses = [];

				let settled = false;
				let opened = false;
				let connectTimer = null;
				let responseTimer = null;

				const cleanup = () => {
					if (connectTimer) clearTimeout(connectTimer);
					if (responseTimer) clearTimeout(responseTimer);
					try {
						ws.close();
					} catch {}
				};

				const fail = (err) => {
					if (settled) return;
					settled = true;
					cleanup();
					reject(err instanceof Error ? err : new Error(String(err)));
				};

				const succeed = (value) => {
					if (settled) return;
					settled = true;
					cleanup();
					resolve(value);
				};

				connectTimer = setTimeout(() => {
					console.warn('Primal cache connect timeout', { requestType, endpoint });
					fail(new Error(`WebSocket connect timeout to ${endpoint}`));
				}, CONNECT_TIMEOUT_MS);

				ws.onopen = () => {
					opened = true;
					if (connectTimer) clearTimeout(connectTimer);

					console.log('Primal cache socket opened', { requestType, endpoint });

					responseTimer = setTimeout(() => {
						console.warn('Primal cache response timeout', { requestType, endpoint });
						fail(
							new Error(`WebSocket response timeout waiting for EOSE from ${endpoint}`),
						);
					}, RESPONSE_TIMEOUT_MS);

					const noParamsTypes = [
						'net_stats',
						'network_stats',
						'nostr_stats',
						'server_name',
						'get_dvm_feeds_all',
						'get_dvm_feeds',
						'explore_media',
						'get_recommended_blossom_servers',
						'explore_topics',
					];

					const validRequestTypes = [
						'feed',
						'long_form_content_feed',
						'zaps_feed',
						'mega_feed_directive',
						'media_feed',
						'thread_view',
						'long_form_content_thread_view',
						'user_profile',
						'user_infos',
						'user_followers',
						'mutual_follows',
						'user_profile_followed_by',
						'contact_list',
						'is_user_following',
						'user_follower_counts',
						'user_scores',
						'user_trustranks',
						'user_profile_scored_content',
						'user_profile_scored_media_thumbnails',
						'events',
						'event_stats',
						'event_actions',
						'event_actions_cnt',
						'find_reposts',
						'event_zaps_by_satszapped',
						'import_events',
						'enrich_feed_events',
						'user_zaps',
						'user_zaps_by_satszapped',
						'user_zaps_sent',
						'get_directmsg_contacts',
						'get_directmsgs',
						'get_directmsg_count',
						'reset_directmsg_count',
						'search',
						'user_search',
						'explore_global_trending_24h',
						'explore_global_mostzapped_4h',
						'explore_people',
						'explore_zaps',
						'scored_users',
						'scored_users_24h',
						'trending_hashtags',
						'trending_images',
						'mutelist',
						'mutelists',
						'allowlist',
						'search_filterlist',
						'is_hidden_by_content_moderation',
						'check_filterlist',
						'get_bookmarks',
						'get_highlights',
						'get_featured_dvm_feeds',
						'dvm_feed_info',
						'dvm_feed',
						'get_dvm_feed_user_actions',
						'get_user_relays',
						'get_user_relays_2',
						'relays',
						'get_media_metadata',
						'get_media_metadata_by_hash',
						'get_notifications',
						'get_notification_counts',
						'get_notifications_seen',
						'set_notifications_seen',
						'user_of_ln_address',
						'nip19_decode',
						'replaceable_event',
						'parametrized_replaceable_event',
						'parametrized_replaceable_events',
						'membership_media_management_stats',
						'membership_media_management_delete',
						'membership_content_backup',
						'membership_content_stats',
						'membership_legends_leaderboard',
						'membership_premium_leaderboard',
						'articles_stats',
						'drafts',
						'top_article',
						'creator_paid_tiers',
						...noParamsTypes,
					];

					if (!validRequestTypes.includes(requestType)) {
						fail(new Error(`Invalid request type: ${requestType}`));
						return;
					}

					const cacheRequest = noParamsTypes.includes(requestType)
						? ['REQ', requestId, { cache: [requestType] }]
						: ['REQ', requestId, { cache: [requestType, params || {}] }];

					try {
						ws.send(JSON.stringify(cacheRequest));
					} catch (err) {
						fail(err);
					}
				};

				ws.onmessage = (event) => {
					let data;
					try {
						data = JSON.parse(event.data);
					} catch {
						console.error('Primal cache invalid JSON', { requestType, endpoint });
						fail(new Error(`Invalid JSON from ${endpoint}`));
						return;
					}

					responses.push(data);

					if (data[0] === 'NOTICE' && data[2] === 'error') {
						console.warn('Primal cache NOTICE error', { requestType, endpoint });
						fail(new Error(`Received NOTICE error from ${endpoint}`));
						return;
					}

					if (data[0] === 'EOSE') {
						const hasData = responses.some(
							(r) => r[0] !== 'EOSE' && r[0] !== 'NOTICE',
						);
						if (!hasData) {
							fail(new Error(`No data returned from ${endpoint}`));
							return;
						}

						console.log('Primal cache success', {
							requestType,
							endpoint,
							durationMs: Date.now() - startedAt,
							messageCount: responses.length,
						});

						succeed(responses);
					}
				};

				ws.onerror = () => {
					console.warn('Primal cache websocket error', { requestType, endpoint });
					fail(new Error(`WebSocket error from ${endpoint}`));
				};

				ws.onclose = () => {
					if (!settled) {
						console.warn('Primal cache socket closed before completion', {
							requestType,
							endpoint,
							opened,
						});
						fail(new Error(`WebSocket closed before completion from ${endpoint}`));
					}
				};
			});

			return result;
		} catch (err) {
			console.warn('Primal cache endpoint failed, trying next', {
				requestType,
				endpoint,
				error: err instanceof Error ? err.message : String(err),
			});
			continue;
		}
	}

	console.error('Primal cache all endpoints failed', { requestType });
	throw new Error('All websocket endpoints failed');
}

export default {
	async fetch(request, env, ctx) {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: corsHeaders,
			});
		}

		if (request.method !== 'POST') {
			return new Response('Method not allowed', {
				status: 405,
				headers: corsHeaders,
			});
		}

		try {
			const body = await request.json();
			const { requestType, params } = body || {};

			if (!requestType) {
				return new Response(JSON.stringify({ error: 'Missing requestType' }), {
					status: 400,
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders,
					},
				});
			}

			const data = await connectToPrimalCache(requestType, params);

			return new Response(JSON.stringify(data), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					...corsHeaders,
				},
			});
		} catch (error) {
			console.error('Primal cache request failed', {
				error: error instanceof Error ? error.message : String(error),
			});

			return new Response(
				JSON.stringify({
					error: error instanceof Error ? error.message : 'Unknown error',
				}),
				{
					status: 500,
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders,
					},
				},
			);
		}
	},
};
