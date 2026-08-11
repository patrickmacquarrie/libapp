# Season snapshot publisher

This standalone Google Apps Script publishes any season sheet into Firestore, preserving the previous live document before every update.

## One-time setup

1. Create a standalone Apps Script project and copy in `Code.gs` and `appsscript.json`.
2. Add an HTML file named `Admin` and copy in `Admin.html`.
3. In **Project Settings → Script properties**, add:
   - `SEASON_ID`: for example, `love-is-blind-uk-3`
   - `SPREADSHEET_ID`: the ID between `/d/` and `/edit` in the Google Sheet URL
   - `PROJECT_ID`: optional; defaults to `lib-oauth`
   - `SEASONS_JSON`: optional; adds more seasons to the admin switcher (see below)
4. Run `previewSeasonSnapshot`. The first run asks for Google Sheets and Firestore authorization. The executing Google account needs source-sheet access and permission to update Firestore in the selected project.

`SEASON_ID` and `SPREADSHEET_ID` remain the default season, so existing one-season setups continue to work.

To switch between seasons in the web app, add a `SEASONS_JSON` Script property. Its value is a JSON array containing only the seasons this admin should be allowed to edit:

```json
[
  {
    "seasonId": "love-is-blind-uk-3",
    "label": "UK Season 3",
    "spreadsheetId": "10lXVUtRSNpd4yBCIxHHZiM65abQMCu9LXYoJ22r7ifY"
  },
  {
    "seasonId": "love-is-blind-br-1",
    "label": "Brazil Season 1",
    "spreadsheetId": "1hTvisEoOLVyClNjG4ZIKroAwr_ZsnTAz2_aC3ZGfyaY"
  }
]
```

The default season is added automatically if it is not repeated in `SEASONS_JSON`. If it is repeated, its spreadsheet ID must match `SPREADSHEET_ID`. This allow-list prevents a mistyped or browser-supplied season ID from opening an arbitrary spreadsheet.

## Private season-admin web app

The `Admin.html` interface provides structured forms for cast members, engagements and wedding outcomes, retreat results, Reunion results, later corrections, episode availability, phase boundaries, budgets, and multipliers. The sheet remains the source of truth.

Deploy it from Apps Script with **Deploy → New deployment → Web app**:

1. Set **Execute as** to **Me**.
2. Set **Who has access** to **Only myself**.
3. Deploy and save the web-app URL.

Use the season menu in the top-right to switch between registered sheets. The app warns before discarding unsaved changes. Every save, preview, publish, and rollback remains scoped to the selected season.

Use **Save draft** for ordinary editing. This updates only the spreadsheet. **Save & preview** validates the sheet and produces the normal publisher summary without changing Firestore. The app automatically opens the result panel; validation failures are shown in red and explicitly confirm that nothing was published. **Publish to the app** runs the existing backup-first publish flow. **Restore latest backup** uses the reversible rollback flow.

There are no automatic triggers. Editing the sheet or admin form never updates the live app until **Publish to the app** is confirmed.

After changing `Code.gs` or `Admin.html`, use **Deploy → Manage deployments**, edit the web-app deployment, choose **New version**, and deploy the update.

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
