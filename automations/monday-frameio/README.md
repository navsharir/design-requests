# Monday → Frame.io folders

Create a concept directly in Monday without submitting a shoot debrief. This Cloudflare Worker creates the concept folder under the client's current year/month with exactly two children:

```
Client / Content / YYYY / existing month / Concept name /
  Raw/
  Edits/
```

It writes the concept-folder link into the existing Monday Frame.io Folder column. It does not create instructions files or send Slack messages. The original review automation handles uploads, editor tags, reviewers and video attachments.

## Bambuu enabled — 14 November 2026

User approved enabling **folder creation and Monday links only** for Bambuu. Deployed as `bambuu-frameio-review` on Cloudflare Free. `ENABLED=true`; the test-item restriction is removed. `BOARD_MAP` contains only Bambuu board 5092056182 and its verified Content folder. Other brands are not enabled. Concepts created before the launch cutoff of 2026-11-14T15:55:21Z are excluded, so items added during the disabled pilot are not backfilled.

Each newly named concept receives Raw and Edits under the current existing year/month folder; the concept-folder URL appears in the existing Frame.io Folder column. There is no instructions file, no new board layout, and no Slack sender in this service. The original review automation remains untouched and handles any subsequent uploads.

The earlier pilot verified inherited Frame.io access, Raw/Edits creation, the Monday link and repeat-scan idempotency. A labelled folder-only launch check was created as Monday item 3358439009 to verify the scheduled scan after activation. The earlier test item 3358423550 is retained for reference.

Reviewer routing changes, consistent Slack sender identity, and historical message editing are outside this folder-only rollout. No changes have been made to the original Slack automation. The user clarified Dubai should use Junior, Sammy and Foong only; that preference is not applied by this service because it never sends or edits Slack messages.

Validation: 37 automated tests pass, including the launch cutoff and Raw repair. `/health` returns enabled state, mode, and the most recent scan's completion time/result, without credentials or customer names.

## Configuration and deployment

1. Install dependencies with `npm ci`; run `npm test`.
2. Add encrypted Worker secrets `MONDAY_TOKEN`, `FRAME_ACCOUNT_ID`, `FRAME_CLIENT_ID`, `FRAME_CLIENT_SECRET`, `SETUP_SECRET`, and `BOARD_MAP`. Never put credentials in this repository, browser URLs, logs or chat. `SLACK_TOKEN` is optional for the setup identity diagnostic only; this service cannot post messages.
3. `BOARD_MAP` follows `board-map.example.json`. Each entry identifies its Monday board, link column and verified Frame.io Content folder. The historical `slackChannelId` field remains for configuration compatibility and is not used to send messages.
4. Deploy with `npx wrangler deploy`. Use the protected `/setup` page to connect approved Frame.io OAuth credentials. Tokens and rotating refresh tokens are persisted in the Durable Object; an uncertain refresh requires reconnection.
5. Bambuu is already enabled. Setup routes are unavailable while enabled. Disable with `ENABLED=false` and redeploy. Broader brand rollout requires separate verified board/folder mappings and user authorization. Keep `ACTIVATED_AT` pinned across deployments; moving it would change which items are eligible.

The scheduled scan runs every five minutes when enabled. Newly created items settle for two minutes, allowing the existing debrief flow to populate its own link. Existing links and items older than the persisted activation boundary are skipped. Existing month folders are matched by numeric month prefix, including full month-name variations; ambiguous matches stop safely.

## Reliability and recovery

All boards share a single Durable Object so shared folder creation cannot race. Runs are capped at 40 external requests. Folder creation checkpoints are persisted before writes; an uncertain result is reconciled by its exact saved name or held for manual review. Writes are never blindly retried. A first-ever Raw addition on an already-linked pilot record is supported without rewriting its Monday link or duplicating Edits.

Inspect `board:BOARD_ID:error:ITEM_ID` records and `lastError` for failures. Before resetting a pending folder key, verify whether that exact folder exists in its parent. Never clear the whole store, which would lose activation boundaries and checkpoints. Do not create another folder after an uncertain response without reconciliation.

Two different concepts with the same name are not silently merged. Renaming an item keeps its original folder. Month selection uses London time at initial provisioning and remains pinned across retries. This worker does not backfill historical concepts, delete existing folders, change board layout, or alter the original review automation.
