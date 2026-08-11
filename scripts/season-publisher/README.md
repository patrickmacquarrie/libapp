# UK3 season snapshot publisher

Create a standalone Apps Script project, copy in `Code.gs` and `appsscript.json`, then run `publishSeasonSnapshot`. The first run asks for Google Sheets and Firestore authorization. The executing Google account must have read access to the source sheet and permission to update Firestore in the `lib-oauth` project.

The Firestore client does not permit nested arrays, so each tab is stored as an array of row objects. `publishedTabRows()` in `index.html` supports this shape and reconstructs the header row for the client. The publisher always replaces `seasons/love-is-blind-uk-3`, making repeated runs deterministic and removing stale sheet data.

`Retro Events` is optional in the client. If that tab has not been created yet, the publisher stores an empty array and a row count of `0`; the other five tabs remain required.

Launch day: set `SEASON_STATUS` to `live` in the sheet's Settings tab, then rerun `publishSeasonSnapshot`.
