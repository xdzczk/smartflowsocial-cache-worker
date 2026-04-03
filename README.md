# Primal Cache WebSocket Worker

A Cloudflare Worker that acts as a proxy to Primal Cache WebSocket endpoints, providing a simple HTTP POST interface to interact with the Primal Nostr cache.

## Features

- HTTP POST interface for WebSocket-based Primal cache queries
- Automatic failover across multiple Primal cache endpoints
- CORS support for browser-based applications
- Support for 80+ Primal cache request types
- Automatic connection retry with timeout handling

## Deployment

### Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io/) installed
- Cloudflare account
- Wrangler (via devDependencies; or install globally with `pnpm add -g wrangler`)

### Deploy to Cloudflare Workers

```bash
# Install dependencies
pnpm install

# Login to Cloudflare
pnpm exec wrangler login

# Deploy the worker
pnpm run deploy
```

## Usage

### Making Requests

Send a POST request to your worker URL with the following JSON body:

```json
{
	"requestType": "request_type_here",
	"params": {
		// request-specific parameters
	}
}
```

### Example using cURL

```bash
curl -X POST https://your-worker.workers.dev \
  -H "Content-Type: application/json" \
  -d '{
    "requestType": "thread_view",
    "params": {
      "event_id": "202cfc372f96c585cd9653a612a4274bfd4ac566a77b1d4dd235c5db24e003e8",
      "limit": 100
    }
  }'
```

### Example using JavaScript (Fetch API)

```javascript
const response = await fetch('https://your-worker.workers.dev', {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
	},
	body: JSON.stringify({
		requestType: 'user_profile',
		params: {
			pubkey: '64-hex-pubkey-here',
		},
	}),
});

const data = await response.json();
console.log(data);
```

## Request Types & Examples

### Feed & Content Discovery

#### User Feed

```json
{
	"requestType": "feed",
	"params": {
		"pubkey": "64-hex-pubkey",
		"limit": 20,
		"since": 0,
		"until": 1234567890,
		"offset": 0,
		"user_pubkey": "64-hex-pubkey",
		"notes": "follows"
	}
}
```

#### Long-form Content Feed

```json
{
	"requestType": "long_form_content_feed",
	"params": {
		"pubkey": "64-hex-pubkey",
		"limit": 20,
		"since": 0,
		"until": 1234567890,
		"offset": 0,
		"user_pubkey": "64-hex-pubkey"
	}
}
```

#### Zaps Feed

```json
{
	"requestType": "zaps_feed",
	"params": {
		"pubkey": "64-hex-pubkey",
		"limit": 20,
		"since": 0,
		"until": 1234567890,
		"offset": 0
	}
}
```

#### Media Feed

```json
{
	"requestType": "media_feed",
	"params": {
		"category": "",
		"since": 0,
		"until": 1234567890,
		"limit": 20,
		"offset": 0,
		"user_pubkey": "64-hex-pubkey"
	}
}
```

### Thread & Conversations

#### Thread View

```json
{
	"requestType": "thread_view",
	"params": {
		"event_id": "64-hex-event-id",
		"limit": 20,
		"since": 0,
		"until": 1234567890,
		"offset": 0,
		"user_pubkey": "64-hex-pubkey",
		"usepgfuncs": true,
		"apply_humaness_check": false
	}
}
```

#### Long-form Content Thread

```json
{
	"requestType": "long_form_content_thread_view",
	"params": {
		"event_id": "64-hex-event-id",
		"limit": 20,
		"user_pubkey": "64-hex-pubkey"
	}
}
```

### User Profile & Social Graph

#### User Profile

```json
{
	"requestType": "user_profile",
	"params": {
		"pubkey": "64-hex-pubkey",
		"user_pubkey": "64-hex-pubkey"
	}
}
```

#### Batch User Info

```json
{
	"requestType": "user_infos",
	"params": {
		"pubkeys": ["64-hex-pubkey-1", "64-hex-pubkey-2"],
		"usepgfuncs": false,
		"apply_humaness_check": false
	}
}
```

#### User Followers

```json
{
	"requestType": "user_followers",
	"params": {
		"pubkey": "64-hex-pubkey",
		"limit": 200
	}
}
```

#### Mutual Follows

```json
{
	"requestType": "mutual_follows",
	"params": {
		"pubkey": "64-hex-pubkey",
		"user_pubkey": "64-hex-pubkey"
	}
}
```

#### Contact List (Follows)

```json
{
	"requestType": "contact_list",
	"params": {
		"pubkey": "64-hex-pubkey",
		"extended_response": true
	}
}
```

#### Is User Following

```json
{
	"requestType": "is_user_following",
	"params": {
		"pubkey": "64-hex-pubkey",
		"user_pubkey": "64-hex-pubkey"
	}
}
```

#### User Follower Counts

```json
{
	"requestType": "user_follower_counts",
	"params": {
		"pubkeys": ["64-hex-pubkey-1", "64-hex-pubkey-2"]
	}
}
```

#### User Scores (Reputation)

```json
{
	"requestType": "user_scores",
	"params": {
		"pubkeys": ["64-hex-pubkey-1", "64-hex-pubkey-2"]
	}
}
```

### Events & Interactions

#### Fetch Events by IDs

```json
{
	"requestType": "events",
	"params": {
		"event_ids": ["64-hex-id-1", "64-hex-id-2"]
	}
}
```

#### Event Stats

```json
{
	"requestType": "event_stats",
	"params": {
		"event_id": "64-hex-event-id"
	}
}
```

#### Event Actions (Reposts, Likes, Replies, Zaps)

```json
{
	"requestType": "event_actions",
	"params": {
		"event_id": "64-hex-event-id",
		"kind": 6,
		"limit": 100,
		"offset": 0
	}
}
```

Note: `kind` can be 6 (reposts), 7 (likes), 1 (replies), or 9735 (zaps)

#### Event Zaps by Amount

```json
{
	"requestType": "event_zaps_by_satszapped",
	"params": {
		"event_id": "64-hex-event-id"
	}
}
```

### Zaps (Lightning Payments)

#### User's Received Zaps

```json
{
	"requestType": "user_zaps",
	"params": {
		"pubkey": "64-hex-pubkey",
		"limit": 100
	}
}
```

#### User's Sent Zaps

```json
{
	"requestType": "user_zaps_sent",
	"params": {
		"pubkey": "64-hex-pubkey",
		"limit": 100
	}
}
```

### Direct Messages

#### Get DM Contacts List

```json
{
	"requestType": "get_directmsg_contacts",
	"params": {
		"receiver": "64-hex-pubkey",
		"limit": 100
	}
}
```

#### Get DMs Between Users

```json
{
	"requestType": "get_directmsgs",
	"params": {
		"receiver": "64-hex-pubkey",
		"sender": "64-hex-pubkey",
		"limit": 100,
		"since": 0,
		"until": 1234567890
	}
}
```

#### Get Unread DM Count

```json
{
	"requestType": "get_directmsg_count",
	"params": {
		"receiver": "64-hex-pubkey",
		"sender": "64-hex-pubkey"
	}
}
```

### Search & Discovery

#### Text Search

```json
{
	"requestType": "search",
	"params": {
		"query": "search terms",
		"limit": 20,
		"offset": 0,
		"user_pubkey": "64-hex-pubkey"
	}
}
```

#### User Search

```json
{
	"requestType": "user_search",
	"params": {
		"query": "username",
		"limit": 10,
		"pubkey": "64-hex-pubkey"
	}
}
```

#### Explore Trending 24h

```json
{
	"requestType": "explore_global_trending_24h",
	"params": {
		"user_pubkey": "64-hex-pubkey"
	}
}
```

#### Explore Most Zapped 4h

```json
{
	"requestType": "explore_global_mostzapped_4h",
	"params": {
		"user_pubkey": "64-hex-pubkey"
	}
}
```

#### Explore People

```json
{
	"requestType": "explore_people",
	"params": {
		"limit": 20,
		"user_pubkey": "64-hex-pubkey"
	}
}
```

#### Trending Hashtags

```json
{
	"requestType": "trending_hashtags",
	"params": {
		"created_after": 1234567890,
		"curated": true
	}
}
```

### Content Moderation & Lists

#### Mute List

```json
{
	"requestType": "mutelist",
	"params": {
		"pubkey": "64-hex-pubkey",
		"extended_response": true
	}
}
```

#### Allow List

```json
{
	"requestType": "allowlist",
	"params": {
		"pubkey": "64-hex-pubkey",
		"extended_response": true
	}
}
```

### Bookmarks & Highlights

#### Get Bookmarks

```json
{
	"requestType": "get_bookmarks",
	"params": {
		"pubkey": "64-hex-pubkey"
	}
}
```

#### Get Highlights

```json
{
	"requestType": "get_highlights",
	"params": {
		"pubkey": "64-hex-pubkey",
		"limit": 100,
		"offset": 0
	}
}
```

### Network & Relays

#### Network Stats

```json
{
	"requestType": "network_stats"
}
```

Note: No params required

#### Nostr Stats

```json
{
	"requestType": "nostr_stats"
}
```

Note: No params required

#### Get User's Relay List

```json
{
	"requestType": "get_user_relays",
	"params": {
		"pubkey": "64-hex-pubkey"
	}
}
```

#### Top Relays

```json
{
	"requestType": "relays",
	"params": {
		"limit": 20
	}
}
```

### Notifications

#### Get Notifications

```json
{
	"requestType": "get_notifications",
	"params": {
		"pubkey": "64-hex-pubkey",
		"limit": 100,
		"since": 0,
		"until": 1234567890
	}
}
```

#### Notification Counts

```json
{
	"requestType": "get_notification_counts",
	"params": {
		"pubkey": "64-hex-pubkey"
	}
}
```

### Utility Functions

#### Lightning Address Lookup

```json
{
	"requestType": "user_of_ln_address",
	"params": {
		"ln_address": "user@domain.com"
	}
}
```

#### NIP-19 Decode

```json
{
	"requestType": "nip19_decode",
	"params": {
		"ids": ["npub1...", "note1..."]
	}
}
```

## Complete List of Supported Request Types

### Feed & Content Discovery

- `feed` - Main user feed
- `long_form_content_feed` - Long-form content/articles feed
- `zaps_feed` - Zaps feed
- `mega_feed_directive` - Advanced feed with directives
- `media_feed` - Media feed

### Thread & Conversations

- `thread_view` - Thread view with parents and replies
- `long_form_content_thread_view` - Long-form content thread

### User Profile & Social Graph

- `user_profile` - User profile
- `user_infos` - Batch user information
- `user_followers` - User followers
- `mutual_follows` - Mutual follows between users
- `user_profile_followed_by` - Users who follow this user
- `contact_list` - User's contact/follow list
- `is_user_following` - Check if user follows another
- `user_follower_counts` - Follower counts for users
- `user_scores` - User reputation scores
- `user_trustranks` - User trust ranks
- `user_profile_scored_content` - User's scored content
- `user_profile_scored_media_thumbnails` - User's media thumbnails

### Events & Interactions

- `events` - Fetch events by IDs
- `event_stats` - Event statistics (likes, reposts, zaps, replies)
- `event_actions` - Event actions (reposts, likes, replies, zaps)
- `event_actions_cnt` - User's actions on an event
- `find_reposts` - Find reposts by specific user
- `event_zaps_by_satszapped` - Event zaps sorted by amount
- `import_events` - Import/store events
- `enrich_feed_events` - Enrich feed events with metadata

### Zaps (Lightning Payments)

- `user_zaps` - User's received zaps
- `user_zaps_by_satszapped` - User's zaps sorted by amount
- `user_zaps_sent` - User's sent zaps

### Direct Messages

- `get_directmsg_contacts` - Get DM contacts list
- `get_directmsgs` - Get DMs between users
- `get_directmsg_count` - Get unread DM count
- `reset_directmsg_count` - Reset DM count (mark as read)

### Search & Discovery

- `search` - Text search
- `user_search` - User search
- `explore_global_trending_24h` - Trending content (24h)
- `explore_global_mostzapped_4h` - Most zapped content (4h)
- `explore_people` - Explore people
- `explore_media` - Explore media
- `explore_topics` - Explore topics/hashtags
- `explore_zaps` - Explore zaps
- `scored_users` - Top users by score
- `scored_users_24h` - Top users (24h)
- `trending_hashtags` - Trending hashtags
- `trending_images` - Trending images

### Content Moderation & Lists

- `mutelist` - User's mute list
- `mutelists` - Multiple mute lists
- `allowlist` - User's allow list
- `search_filterlist` - Search filter list
- `is_hidden_by_content_moderation` - Check if hidden by moderation
- `check_filterlist` - Check filterlist

### Bookmarks & Highlights

- `get_bookmarks` - Get user's bookmarks
- `get_highlights` - Get user's highlights

### DVM Feeds (Data Vending Machines)

- `get_dvm_feeds_all` - All DVM feeds
- `get_dvm_feeds` - Active DVM feeds
- `get_featured_dvm_feeds` - Featured DVM feeds
- `dvm_feed_info` - DVM feed information
- `dvm_feed` - DVM feed results
- `get_dvm_feed_user_actions` - DVM feed user actions

### Relays & Network

- `network_stats` - Network statistics
- `nostr_stats` - Nostr statistics
- `server_name` - Server name
- `get_user_relays` - User's relay list
- `get_user_relays_2` - Multiple users' relays
- `relays` - Top relays

### Media & Blossom

- `get_media_metadata` - Media metadata by URLs
- `get_media_metadata_by_hash` - Media metadata by hash
- `get_recommended_blossom_servers` - Recommended Blossom servers

### Notifications

- `get_notifications` - Get notifications
- `get_notification_counts` - Notification counts
- `get_notifications_seen` - Last seen timestamp
- `set_notifications_seen` - Set notifications as seen

### Utility Functions

- `user_of_ln_address` - Lightning address lookup
- `nip19_decode` - Decode NIP-19 identifiers
- `replaceable_event` - Get replaceable event
- `parametrized_replaceable_event` - Get parameterized replaceable event
- `parametrized_replaceable_events` - Batch parameterized replaceable events

### Membership/Premium Features

- `membership_media_management_stats` - Media management stats
- `membership_media_management_delete` - Delete media
- `membership_content_backup` - Content backup
- `membership_content_stats` - Content statistics
- `membership_legends_leaderboard` - Legends leaderboard
- `membership_premium_leaderboard` - Premium leaderboard

### Articles & Long-form

- `articles_stats` - Article statistics
- `drafts` - User's drafts
- `top_article` - Top article by metric
- `creator_paid_tiers` - Creator paid tiers

## Response Format

The worker returns the raw Primal cache response, which is an array of messages. Each message follows the Nostr event structure:

```json
[
  ["EVENT", "subscription-id", {...event-data...}],
  ["EVENT", "subscription-id", {...event-data...}],
  ["EOSE", "subscription-id"]
]
```

The last message is always `["EOSE", "subscription-id"]` indicating "End Of Stored Events".

## Error Handling

### HTTP Status Codes

- `200` - Success
- `400` - Bad request (invalid JSON, validation / unknown `requestType`, etc.)
- `405` - Method not allowed (only POST is accepted)
- `413` - Request body larger than 256 KiB
- `502` - Bad gateway (upstream Primal cache error, malformed upstream payload, or all endpoints failed with non-timeout errors)
- `504` - Gateway timeout (connect or response timeout on every attempted endpoint)
- `500` - Unexpected internal error

Responses include an `X-Request-Id` header (echoed from the client `X-Request-Id` when valid, otherwise generated) for log correlation.

### Error Response Format

```json
{
	"error": "Error message here"
}
```

Supported Primal `requestType` values are maintained in `src/data/primal-request-types.json` (validated before any upstream WebSocket is opened).

## WebSocket Endpoints

The worker automatically tries these Primal cache endpoints in order:

1. `wss://primal.ytstr.com/v1`
2. `wss://cache.smartflowsocial.com/v1`
3. `wss://cache1.primal.net/v1`
4. `wss://cache2.primal.net/v1`

If one fails, it automatically tries the next one with a 7-second timeout per endpoint.

## CORS Support

The worker includes CORS headers allowing requests from any origin:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, X-Request-Id`
- `Access-Control-Expose-Headers: X-Request-Id`

## Development

### Local Testing

```bash
# Run in development mode
pnpm run dev
```

This will start a local server using Wrangler for testing.

### Quality checks

```bash
pnpm run validate
```

Runs Prettier (check), ESLint, TypeScript, `cf-types:check`, and Vitest. After changing `wrangler.toml` or bindings, run `pnpm run cf-types` and commit `worker-configuration.d.ts` if it changes.

### Project Structure

```
.
├── src/
│   ├── index.ts                 # Worker fetch handler
│   ├── body-schema.ts           # Zod validation for POST JSON
│   ├── http-error.ts            # Typed HTTP errors
│   ├── request-types.ts         # Loads allowlist JSON
│   └── data/
│       └── primal-request-types.json   # Supported Primal requestType values
├── test/                        # Vitest + @cloudflare/vitest-pool-workers
├── worker-configuration.d.ts    # Generated: pnpm run cf-types
├── wrangler.toml
├── package.json
├── CONTRIBUTING.md
└── README.md
```

## License

MIT

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Pull requests are welcome.

## Support

For issues and questions, please open an issue on the GitHub repository.
