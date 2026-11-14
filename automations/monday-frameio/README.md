# Monday → Frame.io folders

Create a concept directly in Monday without submitting a shoot debrief. This Cloudflare Worker creates the concept folder under the client's current year/month with exactly two children:

```
Client / Content / YYYY / existing month / Concept name /
  Raw/
  Edits/
```

It writes the concept-folder link into the existing Monday Frame.io Folder column. It does not create instructions files or send Slack messages. The original review automation handles uploads, editor tags, reviewers and video attachments.

## Pilot status — 14 November 2026

Deployed as `bambuu-frameio-review` in the owner's Cloudflare account. Scheduled execution remains disabled (`ENABLED=false`) and controlled scans are restricted to test item `3358423550` on Bambuu (`TEST_ITEM_ID`). The public design-request website and existing debrief flow remain independent.

Verified live:
- Existing `11 - November` folder reused; concept, Raw and Edits folders exist.
- Existing Monday folder-link column populated; repeated scans preserve it and do not create duplicate folders.
- Frame.io upload completed and inherited Bambuu team access matches the parent.
- Original review automation posted the video in Slack.
- After Monday editor changes Andrej → Nave, new-upload replies correctly reflected the current editor. Bambuu extras switch between Nave and Andrej, with Junior, Sammy and Foong retained.

The standalone pilot preview sender and its Slack write API have been removed. The single preview posted before that discovery remains as test evidence; no more preview messages will be sent.

Unresolved launch gates:
- The latest editor-change reply is reported by Slack as sent by Nave, not 10Ten Bot. Access to the original automation is needed to enforce a consistent bot sender.
- Review-chat evidence was collected for all 19 client boards. Historical extra reviewers differ by brand and sometimes omit the current editor. Dubai history includes a deactivated reviewer; do not guess a replacement.
- Already-posted messages retain the editor at upload time. Editing historical messages requires a change to the original automation.
- Full-volume operation and concurrent slow debrief writes need observation before expansion beyond the pilot.

Validation: 36 automated tests pass. Obsolete standalone-notifier tests were removed with that feature; missing-Raw repair is covered.

## Configuration and deployment

1. Install dependencies with `npm ci`; run `npm test`.
2. Add encrypted Worker secrets `MONDAY_TOKEN`, `FRAME_ACCOUNT_ID`, `FRAME_CLIENT_ID`, `FRAME_CLIENT_SECRET`, `SETUP_SECRET`, and `BOARD_MAP`. Never put credentials in this repository, browser URLs, logs or chat. `SLACK_TOKEN` is optional for the setup identity diagnostic only; this service cannot post messages.
3. `BOARD_MAP` follows `board-map.example.json`. Each entry identifies its Monday board, link column and verified Frame.io Content folder. The historical `slackChannelId` field remains for configuration compatibility and is not used to send messages.
4. Deploy with `npx wrangler deploy`. Use the protected `/setup` page to connect approved Frame.io OAuth credentials. Tokens and rotating refresh tokens are persisted in the Durable Object; an uncertain refresh requires reconnection.
5. Use the protected scan form for the single approved test item. After launch gates are resolved and rollout authorized, remove `TEST_ITEM_ID`, set `ENABLED=true`, and redeploy. Setup routes are unavailable while enabled. Disable by setting `ENABLED=false` and redeploying.

The scheduled scan runs every five minutes when enabled. Newly created items settle for two minutes, allowing the existing debrief flow to populate its own link. Existing links and items older than the persisted activation boundary are skipped. Existing month folders are matched by numeric month prefix, including full month-name variations; ambiguous matches stop safely.

## Reliability and recovery

All boards share a single Durable Object so shared folder creation cannot race. Runs are capped at 40 external requests. Folder creation checkpoints are persisted before writes; an uncertain result is reconciled by its exact saved name or held for manual review. Writes are never blindly retried. A first-ever Raw addition on an already-linked pilot record is supported without rewriting its Monday link or duplicating Edits.

Inspect `board:BOARD_ID:error:ITEM_ID` records and `lastError` for failures. Before resetting a pending folder key, verify whether that exact folder exists in its parent. Never clear the whole store, which would lose activation boundaries and checkpoints. Do not create another folder after an uncertain response without reconciliation.

Two different concepts with the same name are not silently merged. Renaming an item keeps its original folder. Month selection uses London time at initial provisioning and remains pinned across retries. This worker does not backfill historical concepts, delete existing folders, change board layout, or alter the original review automation.
