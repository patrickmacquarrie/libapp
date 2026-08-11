const PROJECT_ID = 'lib-oauth';
const SEASON_ID = 'love-is-blind-uk-3';
const SPREADSHEET_ID = '10lXVUtRSNpd4yBCIxHHZiM65abQMCu9LXYoJ22r7ifY';
const TAB_NAMES = ['Cast', 'Couples', 'Dating Results', 'Reunion Results', 'Settings', 'Retro Events'];

/**
 * Publishes the season sheet to seasons/love-is-blind-uk-3.
 * Safe to rerun: every invocation replaces the same document from fresh sheet data.
 */
function publishSeasonSnapshot() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tabs = {};
  const tabRowCounts = {};

  TAB_NAMES.forEach(function(tabName) {
    const sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet && tabName === 'Retro Events') {
      tabs[tabName] = [];
      tabRowCounts[tabName] = 0;
      return;
    }
    if (!sheet) throw new Error('Missing required sheet tab: ' + tabName);
    const rows = sheet.getDataRange().getDisplayValues();
    tabs[tabName] = rowsToRecords_(tabName, rows);
    tabRowCounts[tabName] = rows.length;
  });

  const status = deriveSeasonStatus_(tabs.Settings);
  const snapshot = Object.assign({
    seasonId: SEASON_ID,
    sourceSheetId: SPREADSHEET_ID,
    publisherVersion: 1,
    status: status,
    publishedAt: new Date(),
    tabNames: TAB_NAMES,
    tabRowCounts: tabRowCounts
  }, tabs);

  const fields = mapFields_(snapshot);
  const approximateBytes = Utilities.newBlob(JSON.stringify(fields)).getBytes().length;
  if (approximateBytes > 900000) {
    throw new Error('Snapshot is approximately ' + approximateBytes +
      " bytes; reduce it before approaching Firestore's 1 MiB document limit.");
  }

  const url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(PROJECT_ID) +
    '/databases/(default)/documents/seasons/' + encodeURIComponent(SEASON_ID);
  const response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    payload: JSON.stringify({fields: fields}),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Firestore publish failed (' + response.getResponseCode() + '): ' + response.getContentText());
  }

  console.log(JSON.stringify({
    published: true,
    projectId: PROJECT_ID,
    seasonId: SEASON_ID,
    status: status,
    tabRowCounts: tabRowCounts,
    approximateBytes: approximateBytes
  }));
}

function rowsToRecords_(tabName, rows) {
  if (!rows.length) throw new Error(tabName + ' has no header row.');
  const seen = {};
  const headers = rows[0].map(function(raw, index) {
    const base = String(raw || '').trim() || 'column_' + (index + 1);
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] === 1 ? base : base + '_' + seen[base];
  });
  return rows.slice(1).filter(function(row) {
    return row.some(function(value) { return value !== ''; });
  }).map(function(row) {
    return Object.fromEntries(headers.map(function(header, index) {
      return [header, String(row[index] == null ? '' : row[index])];
    }));
  });
}

function deriveSeasonStatus_(settings) {
  const explicit = setting_(settings, 'SEASON_STATUS').toLowerCase().replace(/[^a-z]/g, '');
  if (['comingsoon', 'upcoming', 'notstarted'].includes(explicit)) return 'upcoming';
  if (['complete', 'completed', 'finished', 'historical', 'closed', 'done'].includes(explicit)) return 'completed';
  if (explicit) return explicit;
  const availableThrough = parseInt(setting_(settings, 'AVAILABLE_THROUGH_EP'), 10) || 0;
  return availableThrough > 0 ? 'live' : 'upcoming';
}

function setting_(settings, key) {
  const row = settings.find(function(record) { return String(record.key || '').trim() === key; });
  return row ? String(row.value || '').trim() : '';
}

function mapFields_(value) {
  return Object.fromEntries(Object.keys(value).map(function(key) {
    return [key, firestoreValue_(value[key])];
  }));
}

function firestoreValue_(value) {
  if (value === null) return {nullValue: null};
  if (value instanceof Date) return {timestampValue: value.toISOString()};
  if (Array.isArray(value)) return {arrayValue: {values: value.map(firestoreValue_)}};
  if (typeof value === 'object') return {mapValue: {fields: mapFields_(value)}};
  if (typeof value === 'boolean') return {booleanValue: value};
  if (typeof value === 'number') {
    return Number.isInteger(value) ? {integerValue: String(value)} : {doubleValue: value};
  }
  return {stringValue: String(value)};
}
