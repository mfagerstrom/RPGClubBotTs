# Activity Data Emoji Spike (Issue #155)

## Goal
Prototype a flow that extracts a Rich Presence activity icon, downloads it, validates it for
Discord emoji constraints, and returns an upload-ready attachment.

## Feasibility findings
- Rich Presence activities can expose icon assets through Discord activity asset fields.
- In discord.js, icon URLs can be resolved with activity asset URL helpers and forced to PNG size.
- Activity payloads can include multiple icons (large and small), so selection logic is required.
- Icons are often Discord-hosted and already square, which is a strong happy-path for emoji prep.
- Emoji upload constraints still apply, especially square output and 256 KB file limit.

## Prototype implemented
- Added `/activity-emoji` command:
  - Input: `member` (required), optional `activity`, `icon`, `size`, `showinchat`
  - Flow: extract icon candidate -> fetch bytes -> validate format -> validate square + size ->
    deterministic naming -> dedupe check -> return attachment.
- Added shared service: `src/services/ActivityEmojiService.ts`
  - Candidate extraction from activity assets
  - Retrieval with timeout and content-type checks
  - Validation for PNG/GIF dimensions and Discord emoji size limit
  - Deterministic emoji naming and in-memory dedupe by source key and byte hash

## Constraints observed
- Some activity icons may not be retrievable due to host restrictions, missing assets, or rate
  limits.
- Current normalization path is strict: icon must already be square and match selected size.
- PNG/GIF dimensions are validated directly from bytes. Other formats are accepted for download but
  currently fail dimension validation.
- Dedupe is runtime memory only in this spike, not persisted across bot restarts.

## Recommended next step (production hardening)
1. Add an image processing library (for example, `sharp`) to support crop/pad/resize for all
   common formats.
2. Persist dedupe metadata (source key and byte hash) in DB for restart-safe behavior.
3. Add optional animated path (GIF passthrough or normalized animated output) behind explicit user
   choice.
4. Add telemetry for retrieval failures and rate-limit events to tune retries/backoff.
