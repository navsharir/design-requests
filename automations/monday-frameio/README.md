# Monday → Frame.io folders

Create a concept directly in Monday without submitting a shoot debrief. This Cloudflare Worker creates the concept folder under the client's current year/month with exactly two children:

```
Client / Content / YYYY / existing month / Concept name /
  Raw/
  Edits/
```

It writes the concept-folder link into the existing Monday Frame.io Folder column. It does not create instructions files or send Slack messages. The original review automation handles uploads, editor tags, reviewers and video attachments.

## Multiple-board rollout

Configure each brand's verified Monday board, existing Frame.io Folder link column, Content folder and activation cutoff through encrypted `BOARD_MAP`. Runtime account mappings and test evidence belong in private configuration, not this public repository. Non-client boards and subitem boards are not included.

Each new named concept receives exactly Raw and Edits beneath its current year/month/concept folder. No instructions files, Slack messages, reviewer routing or board-layout changes are created by this service. Existing Frame.io links and items before the per-board activation boundary are preserved.

All boards share a single 40-request budget per invocation. A persisted board cursor resumes an interrupted board on the next scheduled scan. Monday uses 500-item pages to keep routine polling efficient. The scanner rotates across boards instead of repeatedly starting with the first brand. New board activation uses its approved cutoff, so concepts created after activation but before the first scan are not discarded.

Validation: 43 automated tests cover global request budgeting, board rotation, launch boundaries, pending-write recovery, Raw repair and existing-link preservation. `/health` reports scan completion, configured/scanned board counts and external request usage without account identifiers.

## Configuration and deployment

1. Install dependencies with `npm ci`; run `npm test`.
2. Add encrypted Worker secrets `MONDAY_TOKEN`, `FRAME_ACCOUNT_ID`, `FRAME_CLIENT_ID`, `FRAME_CLIENT_SECRET`, `SETUP_SECRET`, and `BOARD_MAP`. Never put credentials in this repository, browser URLs, logs or chat. `SLACK_TOKEN` is optional for the setup identity diagnostic only; this service cannot post messages.
3. `BOARD_MAP` follows `board-map.example.json`. Each entry identifies its Monday board, link column and verified Frame.io Content folder. The historical `slackChannelId` field remains for configuration compatibility and is not used to send messages.
4. Deploy with `npx wrangler deploy`. Use the protected `/setup` page to connect approved Frame.io OAuth credentials. Tokens and rotating refresh tokens are persisted in the Durable Object; an uncertain refresh requires reconnection.
5. Set `ENABLED=true` only for an authorized rollout. Setup routes are unavailable while enabled. Disable with `ENABLED=false` and redeploy. Keep existing activation cutoffs pinned across deployments; moving them changes item eligibility. New boards should provide their own `activationCutoff` in `BOARD_MAP`.

The scheduled scan runs every five minutes when enabled. Newly created items settle for two minutes, allowing the existing debrief flow to populate its own link. Existing links and items older than the persisted activation boundary are skipped. Existing month folders are matched by numeric month prefix, including full month-name variations; ambiguous matches stop safely.

## Reliability and recovery

All boards share a single Durable Object so shared folder creation cannot race. Runs are capped at 40 external requests. Folder creation checkpoints are persisted before writes; an uncertain result is reconciled by its exact saved name or held for manual review. Writes are never blindly retried. A first-ever Raw addition on an already-linked pilot record is supported without rewriting its Monday link or duplicating Edits.

Inspect `board:BOARD_ID:error:ITEM_ID` records and `lastError` for failures. Before resetting a pending folder key, verify whether that exact folder exists in its parent. Never clear the whole store, which would lose activation boundaries and checkpoints. Do not create another folder after an uncertain response without reconciliation.

Two different concepts with the same name are not silently merged. Renaming an item keeps its original folder. Month selection uses London time at initial provisioning and remains pinned across retries. This worker does not backfill historical concepts, delete existing folders, change board layout, or alter the original review automation.
