# Monday → Frame.io → Slack

Add a named concept to a configured Monday board. This service creates:

```
Client / Content / 2026 / 11 - NOV / Concept name / Edits
```

It writes the concept folder URL to the existing Monday Frame.io Folder column. Completed uploads in its Edits folder generate a review message with Frame.io and Monday links. It watches new head versions in version stacks too. No shoot debrief submission is required.

## Status

Deployed to the owner's existing Cloudflare account as `bambuu-frameio-review`, with persistent Durable Object storage and a Bambuu-only board mapping. **Disabled pending runtime credentials and a live pilot test.** No live folders, Monday values, or Slack messages have been changed by this service. The public design-request webpage is independent of this service.

Each run is limited to 40 external API requests, below the Free plan's 50-request limit. Incomplete provisioning resumes using persisted checkpoints; folder review rotates through saved records across runs. This batch limit still needs observation under live load, including Cloudflare CPU and duration limits.

Every five minutes it scans configured boards and the Edits folders it created. New items must be at least two minutes old, allowing the existing debrief integration to populate its own link first. Items with existing links are skipped. The original debrief source was not accessible, so coexistence still needs a live test; a very slow debrief can race the final link check. If this occurs, stop this service and reconcile the item/folder before continuing.

## Deploy

1. Connect this GitHub repository to Cloudflare Workers, with the root directory set to `automations/monday-frameio`. Alternatively deploy from this directory with the Wrangler CLI. Use a Cloudflare account with Workers and SQLite Durable Objects available.
2. Install Wrangler with `npm install --save-dev wrangler`, run `npm test`, then `npx wrangler deploy`. The checked-in configuration starts disabled.
3. Add these Worker secrets using Cloudflare's dashboard or `npx wrangler secret put NAME`. Keep tokens out of GitHub, logs, Pages, and chat:
   - `MONDAY_TOKEN`: read board items and update link columns.
   - `FRAME_TOKEN`: a supported Frame.io V4 API credential with access to the target account/project and folder creation. Plan token refresh/rotation according to the credential's lifetime.
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
