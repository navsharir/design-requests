# Monday → Frame.io → Slack

Add a named concept to a configured Monday board. This service creates:

```
Client / Content / 2026 / 11 - NOV / Concept name / Edits
```

It writes the concept folder URL to the existing Monday Frame.io Folder column. The existing 10Ten Bot picks up completed uploads in Edits and sends its normal review message and video. The optional standalone notifier stays disabled to avoid duplicates. No shoot debrief submission is required.

## Status — tested 14 November 2026

Bambuu live test passed: Monday item 3358423550 acquired its Frame.io link; the existing `11 - November` folder was reused; the concept and Edits folders were created; the test video uploaded successfully. Folder access matches the inherited Bambuu team access.

The labelled pilot bot sent a preview at Slack timestamp 1794670538.096529. Crucially, the existing **10Ten Bot** independently picked up this new Edits folder and posted its normal message, reviewer mentions and attached video at 1794670571.183629. No changes to the existing bot were needed. Cloudflare's own Slack sending is now **disabled** to prevent duplicate notifications. Future launch should retain the existing review automation and enable folder/link creation only.

`ENABLED=false` keeps scheduled work disabled pending user review. `TEST_ITEM_ID=3358423550` restricts controlled scans to the approved test concept. `ENABLE_SLACK_NOTIFICATIONS=false` leaves reviews to the existing bot. Remove the test-item restriction only for an authorized board launch. Existing board layout, columns, folders and debrief integration remain unchanged; the test item, folders and messages are retained for review.

Protected `/setup` forms support approved OAuth connection, Slack identity verification and a controlled scan. Set encrypted `SETUP_SECRET`; never publish it. Frame.io OAuth tokens are persisted in the Durable Object and refreshed with rotation. Setup is unavailable while enabled.

Runs use at most 40 external requests. New items settle for two minutes and existing links are preserved. Persistent activation boundaries exclude historical items. Live high-volume operation and a simultaneous slow debrief still require observation before expanding beyond Bambuu.

## Deploy

1. Connect this GitHub repository to Cloudflare Workers, with the root directory set to `automations/monday-frameio`. Alternatively deploy from this directory with the Wrangler CLI. Use a Cloudflare account with Workers and SQLite Durable Objects available.
2. Install Wrangler with `npm install --save-dev wrangler`, run `npm test`, then `npx wrangler deploy`. The checked-in configuration starts disabled.
3. Add these Worker secrets using Cloudflare's dashboard or `npx wrangler secret put NAME`. Keep tokens out of GitHub, logs, Pages, and chat:
   - `MONDAY_TOKEN`: read board items and update link columns.
   - Frame.io OAuth: `FRAME_CLIENT_ID`, `FRAME_CLIENT_SECRET`, then connect through the protected `/setup` OAuth flow. The worker refreshes short-lived access tokens and persists rotated refresh tokens in its Durable Object. An uncertain refresh is held for reconnection. Alternatively, use `FRAME_TOKEN` for a supported direct credential; legacy developer tokens also require `FRAME_LEGACY_AUTH` set to `true`. Do not use a one-hour access token as a permanent unattended credential.
   - `FRAME_ACCOUNT_ID`: the verified Frame.io account ID.
   - `SLACK_TOKEN`: bot credential with `chat:write`; invite the bot to the review channel.
   - `BOARD_MAP`: JSON array using `board-map.example.json` as its shape. Each board needs its own verified link column and client **Content** folder ID, plus the review channel ID. Configuration is kept in a secret because this repository is public.
4. Set `ENABLED = "true"` in `wrangler.toml` and deploy. The first successful scan records a permanent activation boundary for each board and skips older items. Deploying again preserves that boundary.
5. Add one new concept in Monday. After a scan, check the month/concept/Edits folders and Monday link. Upload a small test edit, wait until upload completes, and verify one review message. Run another scan and confirm no duplicates. Test a debrief-created item as well before expanding to more boards.

The API tools connected to Codex do not supply reusable runtime credentials to this service. The deployment needs its own credentials entered securely in Cloudflare. Connecting GitHub alone does not activate the automation.

## Recovery and operating limits

Folder operations and Slack sends are checkpointed before external writes. If a write response is lost, the service reconciles an exact folder name if visible; otherwise it holds the operation rather than blindly retrying. A pending Slack send is held for manual inspection. Check the Durable Object storage under the configured `BOARDS` binding for `board:BOARD_ID:error:ITEM_ID` entries. Logs report board IDs and failure counts, without concept names or tokens.

For a pending folder creation, verify the exact parent/name in Frame.io. If the folder exists, the next scan can adopt it. If it definitely does not exist and the original request has settled, remove only the relevant pending key to retry. Never clear the whole store: that loses activation boundaries and delivery history.

For a pending Slack record, inspect the channel for that item and file. If delivered, replace the record with `{ "sent": true, "ts": "ACTUAL_MESSAGE_TS" }`; if delivery definitely failed, remove only that pending record. Do not assume a timeout means failure. Keys follow `board:BOARD_ID:sent:ITEM_ID:FILE_ID`.

Two concepts with the same name in a month require a manual link or distinct names; they are never silently merged. Renaming an item after folder creation keeps its original folder. Month selection uses London time at the first provisioning attempt and stays fixed through retries. This service does not import historical concepts, watch pre-existing/debrief-created folders, recurse into subfolders under Edits, or replay every historical version in a stack. Only the current head is checked; use separate files if every intermediate upload must produce a message.

The polling load grows with the number of tracked concepts. Start with one board and monitor request limits and cron duration before expansion. The worker slows Frame.io calls to respect list/create limits; upstream rate limits fail safely and are retried on the next scan. Monitor cron failures in Cloudflare. Disable by setting `ENABLED` to `false` and redeploying.

## Development

`npm test` runs offline integration tests with simulated Monday, Frame.io, Slack and persistent storage. Tests cover retries, duplicate prevention, London month rollover, existing links, upload completion, version heads and activation boundaries. Live credential permissions, deployment and end-to-end behavior still require the activation test above.

API references: [Frame.io folder creation](https://developer.frame.io/platform/api-reference/folders/create), [upload status](https://developer.frame.io/platform/v4/api-reference/files/show-file-upload-status), [Monday pagination](https://developer.monday.com/api-reference/docs/querying-board-items), [Slack posting](https://docs.slack.dev/reference/methods/chat.postMessage/), [Cloudflare durable storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
