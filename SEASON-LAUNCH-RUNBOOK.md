# Live season launch runbook

Use this checklist for the first launch and every episode drop. UK3 is the first full production run.

For a new beta season, choose configuration version 2 in Season Admin. A missing version is intentionally treated as legacy v1 so completed seasons such as UK3 cannot be silently reinterpreted.

## Before the release

- Update the season sheet only after confirming the episode results and phase boundary fields. Keep `SEASON_ID` and `SPREADSHEET_ID` paired in the publisher's Script properties.
- Run `previewSeasonSnapshot`. Confirm the intended season, status, available-through episode, non-zero required-tab row counts, a document size below 900,000 bytes, and the returned `releaseHash`. Publishing will accept only that exact previewed sheet state.
- Confirm the latest Firebase Hosting deployment from GitHub `main` is green. For a first-season launch, also run `npm run check` locally.
- Keep one test friend pool and one Global Pool account available for verification.

## Publish and verify

1. Without editing the sheet after preview, run `publishSeasonSnapshot` and save its logged `backupPath` and `appConfigBackupPath`. The season and matching default-season routing metadata are committed together. If the sheet changed, preview it again; a successful publish consumes the preview approval.
2. In Firestore, confirm `seasons/{SEASON_ID}` has the new `publishedAt`, expected `status`, and correct `tabRowCounts`.
   - Settings must be present. Cast, Couples, Dating Results, and Reunion Results may have zero data rows before their data is known. A live Episode 0 snapshot allows pools to form but keeps predictions closed.
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

Authenticated browser failures are stored in Firestore at `clientErrors/{userId}/categories/{category}`. In the Firebase console, open **Firestore Database** and inspect the `clientErrors` collection for recently updated category documents. Use `lastAt`, `category`, `seasonId`, `poolId`, `operation`, and `appBuild` to identify repeated failures. `occurrenceCount` is cumulative, so compare it with the previous check rather than treating an old non-zero count as a new incident.

These reports contain no picks, emails, free-form browser messages, or browser stack traces. Firestore security rules prevent browser clients from reading them. Plausible separately records aggregate `app_error` totals, including failures that happen before sign-in.

Use Google Cloud **Logging → Logs Explorer** for Cloud Functions and infrastructure failures. A useful starting query is:

```text
resource.type="cloud_run_revision"
severity>=ERROR
```

Do not use `jsonPayload.message="Client operation failed"`: the browser writes detailed reports directly to Firestore and no Cloud Function emits that message.

Treat any repeated save failure, wrong season data, exposed picks, or inability to open pools as a stop-the-line incident. A single invitation failure can be handled separately if gameplay and saves remain healthy.

## Roll back

1. Stop editing the season sheet.
2. Run `rollbackSeasonSnapshot` in Apps Script for the same `SEASON_ID`.
3. Confirm the logged `restoredFrom` and, when present, `appConfigRestoredFrom` paths, then verify the app again in a private window.
4. Record what was wrong in the sheet, correct it, run preview, and republish. The failed live version is preserved in the logged `previousLiveSavedTo` backup.

## After the release

- Check Firestore client-error counters and Cloud Logging after the first few friends have used the episode update and again the next day.
- Note any support reports with season, pool, phase, screen, and approximate time; never ask friends to send their picks or passwords.
- After the season is stable, remove obsolete backups manually while retaining at least the last known-good publish.
