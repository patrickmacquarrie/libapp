const DEFAULT_PROJECT_ID = 'lib-oauth';
const REQUIRED_TAB_NAMES = ['Cast', 'Couples', 'Dating Results', 'Reunion Results', 'Settings'];
const OPTIONAL_TAB_NAMES = ['Retro Events'];
const TAB_NAMES = REQUIRED_TAB_NAMES.concat(OPTIONAL_TAB_NAMES);
const BACKUP_COLLECTION = 'seasonSnapshotBackups';
const MAX_SNAPSHOT_BYTES = 900000;

/**
 * Builds and validates a snapshot without changing Firestore.
 * Run this before every live publish and inspect the execution log.
 */
function previewSeasonSnapshot() {
  const config = publisherConfig_();
  const built = buildSeasonSnapshot_(config);
  const summary = publishSummary_(config, built, {preview: true});
  console.log(JSON.stringify(summary));
  return summary;
}

/**
 * Backs up the live season document, then replaces it from fresh sheet data.
 */
function publishSeasonSnapshot() {
  const config = publisherConfig_();
  const built = buildSeasonSnapshot_(config);
  const seasonPath = 'seasons/' + config.seasonId;
  const current = readFirestoreDocument_(config, seasonPath);
  let backupPath = '';

  if (current.exists) {
    backupPath = backupDocumentPath_(config.seasonId, 'publish');
    writeFirestoreDocument_(config, backupPath, current.fields);
  }

  writeFirestoreDocument_(config, seasonPath, built.fields);
  if (backupPath) setLatestBackupPath_(config.seasonId, backupPath);

  const summary = publishSummary_(config, built, {
    published: true,
    documentPath: seasonPath,
    backupPath: backupPath || null
  });
  console.log(JSON.stringify(summary));
  return summary;
}

/**
 * Restores the last backup created for the configured season.
 * The current live document is saved first, making the rollback reversible.
 */
function rollbackSeasonSnapshot() {
  const config = publisherConfig_();
  const seasonPath = 'seasons/' + config.seasonId;
  const backupPath = latestBackupPath_(config.seasonId);
  if (!backupPath) throw new Error('No rollback backup is recorded for ' + config.seasonId + '.');

  const backup = readFirestoreDocument_(config, backupPath);
  if (!backup.exists) throw new Error('The recorded backup no longer exists: ' + backupPath);

  const current = readFirestoreDocument_(config, seasonPath);
  let rescuePath = '';
  if (current.exists) {
    rescuePath = backupDocumentPath_(config.seasonId, 'rollback');
    writeFirestoreDocument_(config, rescuePath, current.fields);
  }

  writeFirestoreDocument_(config, seasonPath, backup.fields);
  if (rescuePath) setLatestBackupPath_(config.seasonId, rescuePath);
  else clearLatestBackupPath_(config.seasonId);

  const summary = {
    rolledBack: true,
    projectId: config.projectId,
    seasonId: config.seasonId,
    restoredFrom: backupPath,
    previousLiveSavedTo: rescuePath || null,
    documentPath: seasonPath
  };
  console.log(JSON.stringify(summary));
  return summary;
}

function publisherConfig_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const config = {
    projectId: String(properties.PROJECT_ID || DEFAULT_PROJECT_ID).trim(),
    seasonId: String(properties.SEASON_ID || '').trim(),
    spreadsheetId: String(properties.SPREADSHEET_ID || '').trim()
  };
  if (!config.seasonId) throw new Error('Set the SEASON_ID script property before running the publisher.');
  if (!config.spreadsheetId) throw new Error('Set the SPREADSHEET_ID script property before running the publisher.');
  if (!/^[A-Za-z0-9_-]+$/.test(config.projectId)) throw new Error('PROJECT_ID contains unsupported characters.');
  if (!/^[A-Za-z0-9_-]+$/.test(config.seasonId)) throw new Error('SEASON_ID contains unsupported characters.');
  if (!/^[A-Za-z0-9_-]+$/.test(config.spreadsheetId)) throw new Error('SPREADSHEET_ID contains unsupported characters.');
  return config;
}

function buildSeasonSnapshot_(config) {
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const tabs = {};
  const tabRowCounts = {};

  TAB_NAMES.forEach(function(tabName) {
    const sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet && OPTIONAL_TAB_NAMES.includes(tabName)) {
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
    seasonId: config.seasonId,
    sourceSheetId: config.spreadsheetId,
    publisherVersion: 2,
    status: status,
    publishedAt: new Date(),
    tabNames: TAB_NAMES,
    tabRowCounts: tabRowCounts
  }, tabs);
  const fields = mapFields_(snapshot);
  const approximateBytes = Utilities.newBlob(JSON.stringify(fields)).getBytes().length;
  if (approximateBytes > MAX_SNAPSHOT_BYTES) {
    throw new Error('Snapshot is approximately ' + approximateBytes +
      " bytes; reduce it before approaching Firestore's 1 MiB document limit.");
  }
  return {fields: fields, status: status, tabRowCounts: tabRowCounts, approximateBytes: approximateBytes};
}

function publishSummary_(config, built, extra) {
  return Object.assign({
    projectId: config.projectId,
    seasonId: config.seasonId,
    spreadsheetId: config.spreadsheetId,
    status: built.status,
    tabRowCounts: built.tabRowCounts,
    approximateBytes: built.approximateBytes
  }, extra || {});
}

function backupDocumentPath_(seasonId, reason) {
  const timestamp = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd_HHmmss_SSS');
  return BACKUP_COLLECTION + '/' + seasonId + '__' + timestamp + '__' + reason;
}

function latestBackupPropertyKey_(seasonId) {
  return 'LAST_BACKUP_PATH__' + seasonId;
}

function latestBackupPath_(seasonId) {
  return PropertiesService.getScriptProperties().getProperty(latestBackupPropertyKey_(seasonId)) || '';
}

function setLatestBackupPath_(seasonId, path) {
  PropertiesService.getScriptProperties().setProperty(latestBackupPropertyKey_(seasonId), path);
}

function clearLatestBackupPath_(seasonId) {
  PropertiesService.getScriptProperties().deleteProperty(latestBackupPropertyKey_(seasonId));
}

function readFirestoreDocument_(config, documentPath) {
  const response = UrlFetchApp.fetch(firestoreDocumentUrl_(config.projectId, documentPath), {
    method: 'get',
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    muteHttpExceptions: true
  });
  if (response.getResponseCode() === 404) return {exists: false, fields: {}};
  assertFirestoreResponse_(response, 'read ' + documentPath);
  const document = JSON.parse(response.getContentText());
  return {exists: true, fields: document.fields || {}};
}

function writeFirestoreDocument_(config, documentPath, fields) {
  const approximateBytes = Utilities.newBlob(JSON.stringify(fields)).getBytes().length;
  if (approximateBytes > MAX_SNAPSHOT_BYTES) {
    throw new Error('Refusing to write an approximately ' + approximateBytes + '-byte Firestore document.');
  }
  const response = UrlFetchApp.fetch(firestoreDocumentUrl_(config.projectId, documentPath), {
    method: 'patch',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    payload: JSON.stringify({fields: fields}),
    muteHttpExceptions: true
  });
  assertFirestoreResponse_(response, 'write ' + documentPath);
}

function firestoreDocumentUrl_(projectId, documentPath) {
  const encodedPath = String(documentPath).split('/').map(encodeURIComponent).join('/');
  return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) +
    '/databases/(default)/documents/' + encodedPath;
}

function assertFirestoreResponse_(response, operation) {
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Firestore could not ' + operation + ' (' + code + '): ' + response.getContentText());
  }
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
