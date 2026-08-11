# Season snapshot publisher

This standalone Google Apps Script publishes any season sheet into Firestore, preserving the previous live document before every update.

## One-time setup

1. Create a standalone Apps Script project and copy in `Code.gs` and `appsscript.json`.
2. In **Project Settings → Script properties**, add:
   - `SEASON_ID`: for example, `love-is-blind-uk-3`
   - `SPREADSHEET_ID`: the ID between `/d/` and `/edit` in the Google Sheet URL
   - `PROJECT_ID`: optional; defaults to `lib-oauth`
3. Run `previewSeasonSnapshot`. The first run asks for Google Sheets and Firestore authorization. The executing Google account needs source-sheet access and permission to update Firestore in the selected project.

Changing `SEASON_ID` and `SPREADSHEET_ID` is all that is required to use the publisher for another season. Always change both properties together.

## Normal publishing

1. Run `previewSeasonSnapshot` and inspect the execution log. Confirm the season ID, sheet ID, status, row counts, and document size.
2. Run `publishSeasonSnapshot`.
3. Record the returned `backupPath`, then verify the app in a private browser window.

The live document is `seasons/{SEASON_ID}`. Before replacing it, the publisher copies the current Firestore fields to `seasonSnapshotBackups/{SEASON_ID}__{timestamp}__publish`. The backup collection is not exposed by the app's Firestore rules.

`Retro Events` is optional and publishes as an empty array when absent. `Cast`, `Couples`, `Dating Results`, `Reunion Results`, and `Settings` are required. Tabs are stored as arrays of row objects because Firestore does not support nested arrays.

## Rollback

Run `rollbackSeasonSnapshot` to restore the last recorded backup for the configured season. The publisher first saves the current live document to a `__rollback` backup, so running rollback again reverses the rollback.

Rollback pointers are stored per season in Apps Script properties. Do not delete a backup that may still be needed. Older backups can be removed manually from Firestore after the season is stable.

See [`SEASON-LAUNCH-RUNBOOK.md`](../../SEASON-LAUNCH-RUNBOOK.md) for the complete live-episode checklist.
