# Live season launch runbook

Use this checklist for the first launch and every episode drop. UK3 is the first full production run.

## Before the release

- Update the season sheet only after confirming the episode results and phase boundary fields. Keep `SEASON_ID` and `SPREADSHEET_ID` paired in the publisher's Script properties.
- Run `previewSeasonSnapshot`. Confirm the intended season, status, available-through episode, non-zero required-tab row counts, and a document size below 900,000 bytes.
- Confirm the latest Firebase Hosting deployment from GitHub `main` is green. For a first-season launch, also run `npm run check` locally.
- Keep one test friend pool and one Global Pool account available for verification.

## Publish and verify

1. Run `publishSeasonSnapshot` and save its logged `backupPath`.
2. In Firestore, confirm `seasons/{SEASON_ID}` has the new `publishedAt`, expected `status`, and correct `tabRowCounts`.
   - Cast, Couples, and Settings must be present. Dating Results and Reunion Results may have zero data rows before those episodes air.
3. Open [Through the Wall](https://throughthewall.ca/) in a private browser window. Sign in and verify:
   - the season opens;
   - the correct episodes and cast are visible;
   - existing picks/progress load;
   - one harmless new pick saves and shows **saved**;
   - the Global Pool and a friend pool both load;
   - an invitation can be sent or accepted when invitation behaviour changed.
4. Check again on a phone-sized screen. Do not edit the sheet during verification.

Normal player pages fail closed when the published snapshot is missing or incomplete; they do not silently read the Google Sheet. For an admin-only source comparison, deliberately append `?adminSeasonSource=sheet`. Cloud Functions will still use Firestore, so do not share that URL or treat it as a live workaround.

## Monitor

In Google Cloud **Logging → Logs Explorer**, select the `lib-oauth` project and use:

```text
resource.type="cloud_run_revision"
jsonPayload.message="Client operation failed"
```

Filter further with `jsonPayload.category`, `jsonPayload.seasonId`, `jsonPayload.poolId`, or `jsonPayload.appBuild`. Categories cover failed saves, season loads, pool opens/creation, invitations, mirror sync, lobby loads, rendering, and startup. Reports contain no picks, emails, or browser stack traces. Plausible also records `app_error` totals, including failures that happen before sign-in.

Treat any repeated save failure, wrong season data, exposed picks, or inability to open pools as a stop-the-line incident. A single invitation failure can be handled separately if gameplay and saves remain healthy.

## Roll back

1. Stop editing the season sheet.
2. Run `rollbackSeasonSnapshot` in Apps Script for the same `SEASON_ID`.
3. Confirm the logged `restoredFrom` path and verify the app again in a private window.
4. Record what was wrong in the sheet, correct it, run preview, and republish. The failed live version is preserved in the logged `previousLiveSavedTo` backup.

## After the release

- Check logs after the first few friends have used the episode update and again the next day.
- Note any support reports with season, pool, phase, screen, and approximate time; never ask friends to send their picks or passwords.
- After the season is stable, remove obsolete backups manually while retaining at least the last known-good publish.
