const DEFAULT_PROJECT_ID = 'lib-oauth';
const REQUIRED_TAB_NAMES = ['Cast', 'Couples', 'Dating Results', 'Reunion Results', 'Settings'];
const OPTIONAL_TAB_NAMES = ['Retro Events'];
const TAB_NAMES = REQUIRED_TAB_NAMES.concat(OPTIONAL_TAB_NAMES);
const BACKUP_COLLECTION = 'seasonSnapshotBackups';
const APP_CONFIG_PATH = 'appConfig/public';
const SEASON_CATALOG_PATH = 'appConfig/seasonCatalog';
const APP_CONFIG_BACKUP_COLLECTION = 'appConfigBackups';
const PREVIEW_HASH_PROPERTY_PREFIX = 'LAST_PREVIEW_HASH__';
const APP_CONFIG_BACKUP_PROPERTY_PREFIX = 'LAST_APP_CONFIG_BACKUP_PATH__';
const MAX_SNAPSHOT_BYTES = 900000;
const ADMIN_SETTING_DEFAULTS = {
  CONFIG_VERSION: '1', SEASON_STATUS: 'upcoming', CAST_COMPLETE: 'FALSE', ALLOW_INCOMPLETE_CAST: 'FALSE', RELEASE_LABEL: '',
  AVAILABLE_THROUGH_EP: '0', BOUNDARIES_LIVE: 'TRUE',
  PODS_START_EP: '1', PODS_END_EP: '6', DATING_START_EP: '5', DATING_END_EP: '9',
  RETREAT_START_EP: '5', RETREAT_END_EP: '9', WEDDINGS_START_EP: '9', WEDDINGS_END_EP: '12',
  REUNION_START_EP: '12', REUNION_END_EP: '13',
  PODS_BOUNDARY_FINAL: 'FALSE', DATING_BOUNDARY_FINAL: 'FALSE', WEDDINGS_BOUNDARY_FINAL: 'FALSE', REUNION_BOUNDARY_FINAL: 'FALSE',
  PODS_RESULTS_READY: 'FALSE', DATING_RESULTS_READY: 'FALSE', WEDDINGS_RESULTS_READY: 'FALSE', REUNION_RESULTS_READY: 'FALSE',
  PODS_BUDGET: '200', PODS_CAP: '60', DATING_BUDGET: '150', DATING_CAP: '40',
  WEDDINGS_BUDGET: '150', WEDDINGS_CAP: '80', REUNION_BUDGET: '100', REUNION_CAP: '40',
  DATING_SEX_MULT: '1', DATING_FLIRT_MULT: '2', DATING_BREAKUP_MULT: '3',
  WEDDINGS_MARRIED_MULT: '1', WEDDINGS_SAYS_NO_MULT: '1.5', WEDDINGS_CALLED_OFF_MULT: '1.75',
  WEDDINGS_LEAD_STEP: '.25', WEDDINGS_LEAD_CAP: '1.75',
  REUNION_STILL_MULT: '1', REUNION_SPLIT_MULT: '2', REUNION_MARRIED_SPLIT_MULT: '2',
  REUNION_BACK_MULT: '2', REUNION_NEW_COUPLE_MULT: '5', REUNION_LIFE_UPDATE_MULT: '5', REUNION_ABSENT_MULT: '2'
};
const RELEASE_COMPARISON_SETTINGS = [
  'CONFIG_VERSION', 'SEASON_STATUS', 'CAST_COMPLETE', 'ALLOW_INCOMPLETE_CAST', 'AVAILABLE_THROUGH_EP', 'BOUNDARIES_LIVE',
  'PODS_BOUNDARY_FINAL', 'DATING_BOUNDARY_FINAL', 'WEDDINGS_BOUNDARY_FINAL', 'REUNION_BOUNDARY_FINAL',
  'PODS_RESULTS_READY', 'DATING_RESULTS_READY', 'WEDDINGS_RESULTS_READY', 'REUNION_RESULTS_READY'
];
const ADMIN_TABLE_HEADERS = {
  cast: ['Gender', 'Name'],
  couples: ['ID', 'Him', 'Her', 'Engaged Ep', 'Wedding', 'Who Says No', 'Breakup Ep', 'Settled Ep', 'Together Now', 'lock_ep', 'Pods Eligible', 'Dating Eligible', 'Reunion Status Eligible'],
  datingResults: ['Market', 'Couple ID', 'Episode', 'Person', 'Confirmed'],
  reunionResults: ['Market', 'Couple/Person ID or Name', 'Value', 'Notes'],
  retroEvents: ['Market', 'Target', 'Void Market', 'Applies Phase', 'Revealed Ep', 'Note', 'Confirmed']
};
const ADMIN_TABLE_KEYS = {
  cast: ['gender', 'name'],
  couples: ['id', 'him', 'her', 'engagedEp', 'wedding', 'whoSaysNo', 'breakupEp', 'settledEp', 'togetherNow', 'lockEp', 'podsEligible', 'datingEligible', 'reunionStatusEligible'],
  datingResults: ['market', 'coupleId', 'episode', 'person', 'confirmed'],
  reunionResults: ['market', 'target', 'value', 'notes'],
  retroEvents: ['market', 'target', 'voidMarket', 'appliesPhase', 'revealedEp', 'note', 'confirmed']
};
const ADMIN_EDITABLE_SETTINGS = [
  'CONFIG_VERSION', 'SEASON_STATUS', 'CAST_COMPLETE', 'ALLOW_INCOMPLETE_CAST', 'RELEASE_LABEL', 'AVAILABLE_THROUGH_EP', 'BOUNDARIES_LIVE',
  'PODS_START_EP', 'PODS_END_EP', 'DATING_START_EP', 'DATING_END_EP',
  'RETREAT_START_EP', 'RETREAT_END_EP', 'WEDDINGS_START_EP', 'WEDDINGS_END_EP',
  'REUNION_START_EP', 'REUNION_END_EP',
  'PODS_BOUNDARY_FINAL', 'DATING_BOUNDARY_FINAL', 'WEDDINGS_BOUNDARY_FINAL', 'REUNION_BOUNDARY_FINAL',
  'PODS_RESULTS_READY', 'DATING_RESULTS_READY', 'WEDDINGS_RESULTS_READY', 'REUNION_RESULTS_READY',
  'PODS_BUDGET', 'PODS_CAP', 'DATING_BUDGET', 'DATING_CAP',
  'WEDDINGS_BUDGET', 'WEDDINGS_CAP', 'REUNION_BUDGET', 'REUNION_CAP',
  'DATING_SEX_MULT', 'DATING_FLIRT_MULT', 'DATING_BREAKUP_MULT',
  'WEDDINGS_MARRIED_MULT', 'WEDDINGS_SAYS_NO_MULT', 'WEDDINGS_CALLED_OFF_MULT',
  'WEDDINGS_LEAD_STEP', 'WEDDINGS_LEAD_CAP',
  'REUNION_STILL_MULT', 'REUNION_SPLIT_MULT', 'REUNION_MARRIED_SPLIT_MULT',
  'REUNION_BACK_MULT', 'REUNION_NEW_COUPLE_MULT', 'REUNION_LIFE_UPDATE_MULT', 'REUNION_ABSENT_MULT'
];

/**
 * Serves the private season-admin interface when this project is deployed as
 * an Apps Script web app. Access should be restricted to the script owner.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Admin')
    .setTitle('Through the Wall Season Admin')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Returns the selected registered season sheet as a structured model for the admin UI. */
function getSeasonAdminData(seasonId) {
  const config = publisherConfig_(seasonId);
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const settingsRows = readAdminTable_(spreadsheet, 'Settings');
  const settings = {};
  settingsRows.forEach(function(row) {
    if (row.key) settings[row.key] = row.value;
  });
  // A missing version means legacy interpretation. Returning it explicitly
  // prevents the browser defaults from silently upgrading an existing season.
  if (!String(settings.CONFIG_VERSION || '').trim()) settings.CONFIG_VERSION = '1';
  return {
    projectId: config.projectId,
    seasonId: config.seasonId,
    spreadsheetId: config.spreadsheetId,
    spreadsheetName: spreadsheet.getName(),
    seasons: config.seasons,
    defaultSeasonId: currentDefaultSeasonId_(config),
    settings: settings,
    cast: readAdminTable_(spreadsheet, 'Cast'),
    couples: readAdminTable_(spreadsheet, 'Couples'),
    datingResults: readAdminTable_(spreadsheet, 'Dating Results'),
    reunionResults: readAdminTable_(spreadsheet, 'Reunion Results'),
    retroEvents: readAdminTable_(spreadsheet, 'Retro Events', true),
    latestBackupPath: latestBackupPath_(config.seasonId)
  };
}

/** Makes a published, non-completed season the app default and Global Pool season. */
function setDefaultSeasonFromAdmin(seasonId) {
  const config = publisherConfig_(seasonId);
  const seasonPath = 'seasons/' + config.seasonId;
  const published = readFirestoreDocument_(config, seasonPath);
  if (!published.exists) {
    throw new Error('Publish this season before making it the live/default season.');
  }
  const status = firestoreStringField_(published.fields, 'status').toLowerCase();
  if (status === 'completed') {
    throw new Error('A completed season cannot be the live/default season. Change it to Live, publish it, then try again.');
  }
  if (!['live', 'upcoming'].includes(status)) {
    throw new Error('The published season must be Live or Upcoming before it can become the default.');
  }

  const registryEntry = config.seasons.find(function(season) {
    return season.seasonId === config.seasonId;
  });
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const settings = readAdminTable_(spreadsheet, 'Settings');
  const metadata = publisherSeasonMetadata_(registryEntry, status, setting_(settings, 'RELEASE_LABEL'));
  const current = readFirestoreDocument_(config, APP_CONFIG_PATH);
  const alreadyDefault = current.exists && firestoreStringField_(current.fields, 'defaultSeasonId') === config.seasonId;
  const writes = [];
  let backupPath = '';
  if (current.exists && !alreadyDefault) {
    backupPath = APP_CONFIG_BACKUP_COLLECTION + '/default__' + timestampId_();
    writes.push({documentPath: backupPath, fields: current.fields});
  }
  writes.push({documentPath: APP_CONFIG_PATH, fields: mapFields_({
    defaultSeasonId: config.seasonId,
    globalPoolSeasonId: config.seasonId,
    defaultSeasonLabel: metadata.label,
    sourceSheetId: config.spreadsheetId,
    status: status,
    defaultSeason: metadata,
    updatedAt: new Date()
  })});
  commitFirestoreDocuments_(config, writes);
  return {
    changed: !alreadyDefault,
    defaultSeasonId: config.seasonId,
    globalPoolSeasonId: config.seasonId,
    previousConfigBackupPath: backupPath || null,
    model: getSeasonAdminData(config.seasonId)
  };
}

/**
 * Validates a season sheet, then adds it to the private admin allow-list.
 * This only connects the sheet; it does not change the sheet or Firestore.
 */
function connectSeasonFromAdmin(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The season connection form was not received correctly.');
  }
  const spreadsheetId = publisherSpreadsheetId_(payload.spreadsheetUrl || payload.spreadsheetId);
  const requested = normalizePublisherSeason_({
    seasonId: cleanAdminString_(payload.seasonId, 100),
    spreadsheetId: spreadsheetId,
    label: cleanAdminString_(payload.label, 100) || cleanAdminString_(payload.seasonId, 100)
  }, 'new season');

  const spreadsheet = SpreadsheetApp.openById(requested.spreadsheetId);
  REQUIRED_TAB_NAMES.forEach(function(tabName) {
    if (!spreadsheet.getSheetByName(tabName)) {
      throw new Error('That spreadsheet is missing the required "' + tabName + '" tab.');
    }
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const propertyStore = PropertiesService.getScriptProperties();
    const seasons = publisherSeasonRegistryFromProperties_(propertyStore.getProperties());
    const updated = upsertPublisherSeason_(seasons, requested);
    propertyStore.setProperty('SEASONS_JSON', JSON.stringify(updated));
  } finally {
    lock.releaseLock();
  }
  return getSeasonAdminData(requested.seasonId);
}

/** Saves form changes to the season sheet without publishing to Firestore. */
function saveSeasonAdminDraft(payload) {
  const config = publisherConfig_(payload && payload.seasonId);
  const clean = validateSeasonAdminPayload_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
    writeAdminTable_(spreadsheet, 'Cast', ADMIN_TABLE_HEADERS.cast, clean.cast);
    writeAdminTable_(spreadsheet, 'Couples', ADMIN_TABLE_HEADERS.couples, clean.couples);
    writeAdminTable_(spreadsheet, 'Dating Results', ADMIN_TABLE_HEADERS.datingResults, clean.datingResults);
    writeAdminTable_(spreadsheet, 'Reunion Results', ADMIN_TABLE_HEADERS.reunionResults, clean.reunionResults);
    writeAdminTable_(spreadsheet, 'Retro Events', ADMIN_TABLE_HEADERS.retroEvents, clean.retroEvents, true);
    mergeAdminSettings_(spreadsheet, clean.settings);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return {saved: true, model: getSeasonAdminData(config.seasonId)};
}

/** Saves the draft, then performs the existing read-only publisher preview. */
function previewSeasonFromAdmin(payload) {
  saveSeasonAdminDraft(payload);
  return previewSeasonSnapshot(payload.seasonId);
}

/** Publishes the exact sheet state approved by the latest preview. */
function publishSeasonFromAdmin(seasonId) {
  const requestedSeasonId = typeof seasonId === 'object' && seasonId ? seasonId.seasonId : seasonId;
  return publishSeasonSnapshot(requestedSeasonId);
}

/** Exposes the existing reversible rollback to the private admin UI. */
function rollbackSeasonFromAdmin(seasonId) {
  return rollbackSeasonSnapshot(seasonId);
}

/**
 * Builds and validates a snapshot without changing Firestore.
 * Run this before every live publish and inspect the execution log.
 */
function previewSeasonSnapshot(seasonId) {
  const config = publisherConfig_(seasonId);
  const built = buildSeasonSnapshot_(config);
  assertPublishableSeasonStatus_(config, built);
  const releaseHash = seasonReleaseHash_(built);
  const seasonPath = 'seasons/' + config.seasonId;
  const current = readFirestoreDocument_(config, seasonPath);
  const comparison = seasonReleaseComparison_(built, current);
  recordPreviewHash_(config.seasonId, releaseHash);
  const summary = publishSummary_(config, built, {
    preview: true,
    releaseHash: releaseHash,
    documentPath: seasonPath,
    comparison: comparison,
    warnings: comparison.warnings
  });
  console.log(JSON.stringify(summary));
  return summary;
}

/**
 * Backs up the live season document, then replaces it from fresh sheet data.
 */
function publishSeasonSnapshot(seasonId) {
  const config = publisherConfig_(seasonId);
  const built = buildSeasonSnapshot_(config);
  assertPublishableSeasonStatus_(config, built);
  const releaseHash = seasonReleaseHash_(built);
  assertMatchesLatestPreview_(config.seasonId, releaseHash);
  const publishedStatus = firestoreStringField_(built.fields, 'status').toLowerCase();
  const currentAppConfig = readFirestoreDocument_(config, APP_CONFIG_PATH);
  const currentCatalog = readFirestoreDocument_(config, SEASON_CATALOG_PATH);
  const currentDefaultSeasonId = currentAppConfig.exists
    ? firestoreStringField_(currentAppConfig.fields, 'defaultSeasonId') || config.fallbackDefaultSeasonId
    : config.fallbackDefaultSeasonId;
  const isCurrentDefault = currentDefaultSeasonId === config.seasonId;
  if (isCurrentDefault && publishedStatus === 'completed') {
    throw new Error('Choose another live/default season before publishing this season as Completed.');
  }
  const seasonPath = 'seasons/' + config.seasonId;
  const current = readFirestoreDocument_(config, seasonPath);
  const comparison = seasonReleaseComparison_(built, current);
  const releaseId = timestampId_();
  const writes = [];
  let backupPath = '';
  let appConfigBackupPath = '';

  if (current.exists) {
    backupPath = backupDocumentPath_(config.seasonId, 'publish', releaseId);
    writes.push({documentPath: backupPath, fields: current.fields});
  }
  writes.push({documentPath: seasonPath, fields: built.fields});
  writes.push({
    documentPath: SEASON_CATALOG_PATH,
    fields: seasonCatalogFieldsWithEntry_(currentCatalog, seasonCatalogEntry_(config.seasonId, built.fields))
  });

  if (isCurrentDefault) {
    if (currentAppConfig.exists) {
      appConfigBackupPath = APP_CONFIG_BACKUP_COLLECTION + '/' + config.seasonId + '__' + releaseId + '__publish';
      writes.push({documentPath: appConfigBackupPath, fields: currentAppConfig.fields});
    }
    const registryEntry = config.seasons.find(function(season) { return season.seasonId === config.seasonId; });
    const settings = snapshotSettings_(built.snapshot);
    const metadata = publisherSeasonMetadata_(registryEntry, publishedStatus, settings.RELEASE_LABEL);
    writes.push({documentPath: APP_CONFIG_PATH, fields: mapFields_({
      defaultSeasonId: config.seasonId,
      globalPoolSeasonId: config.seasonId,
      defaultSeasonLabel: metadata.label,
      sourceSheetId: config.spreadsheetId,
      status: publishedStatus,
      defaultSeason: metadata,
      updatedAt: new Date()
    })});
  }

  commitFirestoreDocuments_(config, writes);
  const operationalWarnings = [];
  try {
    if (backupPath) setLatestBackupPath_(config.seasonId, backupPath);
    if (appConfigBackupPath) setLatestAppConfigBackupPath_(config.seasonId, appConfigBackupPath);
    clearPreviewHash_(config.seasonId);
  } catch (error) {
    operationalWarnings.push('The live release succeeded, but publisher recovery metadata could not be updated: ' + error.message);
  }

  const summary = publishSummary_(config, built, {
    published: true,
    releaseHash: releaseHash,
    documentPath: seasonPath,
    backupPath: backupPath || null,
    appConfigBackupPath: appConfigBackupPath || null,
    comparison: comparison,
    warnings: comparison.warnings.concat(operationalWarnings)
  });
  console.log(JSON.stringify(summary));
  return summary;
}

/**
 * Restores the last backup created for the configured season.
 * The current live document is saved first, making the rollback reversible.
 */
function rollbackSeasonSnapshot(seasonId) {
  const config = publisherConfig_(seasonId);
  const seasonPath = 'seasons/' + config.seasonId;
  const backupPath = latestBackupPath_(config.seasonId);
  if (!backupPath) throw new Error('No rollback backup is recorded for ' + config.seasonId + '.');

  const backup = readFirestoreDocument_(config, backupPath);
  if (!backup.exists) throw new Error('The recorded backup no longer exists: ' + backupPath);

  const current = readFirestoreDocument_(config, seasonPath);
  const currentCatalog = readFirestoreDocument_(config, SEASON_CATALOG_PATH);
  const isCurrentDefault = currentDefaultSeasonId_(config) === config.seasonId;
  const appConfigBackupPath = isCurrentDefault ? latestAppConfigBackupPath_(config.seasonId) : '';
  const appConfigBackup = appConfigBackupPath
    ? readFirestoreDocument_(config, appConfigBackupPath)
    : {exists: false, fields: {}};
  if (appConfigBackupPath && !appConfigBackup.exists) {
    throw new Error('The recorded app configuration backup no longer exists: ' + appConfigBackupPath);
  }
  const currentAppConfig = appConfigBackup.exists
    ? readFirestoreDocument_(config, APP_CONFIG_PATH)
    : {exists: false, fields: {}};
  const rollbackId = timestampId_();
  const writes = [];
  let rescuePath = '';
  let appConfigRescuePath = '';
  if (current.exists) {
    rescuePath = backupDocumentPath_(config.seasonId, 'rollback', rollbackId);
    writes.push({documentPath: rescuePath, fields: current.fields});
  }
  writes.push({documentPath: seasonPath, fields: backup.fields});
  writes.push({
    documentPath: SEASON_CATALOG_PATH,
    fields: seasonCatalogFieldsWithEntry_(currentCatalog, seasonCatalogEntry_(config.seasonId, backup.fields))
  });
  if (appConfigBackup.exists) {
    if (currentAppConfig.exists) {
      appConfigRescuePath = APP_CONFIG_BACKUP_COLLECTION + '/' + config.seasonId + '__' + rollbackId + '__rollback';
      writes.push({documentPath: appConfigRescuePath, fields: currentAppConfig.fields});
    }
    writes.push({documentPath: APP_CONFIG_PATH, fields: appConfigBackup.fields});
  }

  commitFirestoreDocuments_(config, writes);
  const operationalWarnings = [];
  try {
    if (rescuePath) setLatestBackupPath_(config.seasonId, rescuePath);
    else clearLatestBackupPath_(config.seasonId);
    if (appConfigRescuePath) setLatestAppConfigBackupPath_(config.seasonId, appConfigRescuePath);
    else clearLatestAppConfigBackupPath_(config.seasonId);
  } catch (error) {
    operationalWarnings.push('Rollback succeeded, but publisher recovery metadata could not be updated: ' + error.message);
  }

  const summary = {
    rolledBack: true,
    projectId: config.projectId,
    seasonId: config.seasonId,
    restoredFrom: backupPath,
    previousLiveSavedTo: rescuePath || null,
    appConfigRestoredFrom: appConfigBackupPath || null,
    previousAppConfigSavedTo: appConfigRescuePath || null,
    documentPath: seasonPath,
    // The deployed season write invokes recomputeGlobalStandingsOnSeasonUpdate.
    // This records the repair path without duplicating scoring in Apps Script.
    standingsRepair: {status: 'scheduled', source: 'season-update-trigger'},
    warnings: operationalWarnings
  };
  console.log(JSON.stringify(summary));
  return summary;
}

/** Rebuilds the compact signed-in season catalog from all published seasons. */
function rebuildSeasonCatalog(seasonId) {
  const config = publisherConfig_(seasonId);
  const seasons = listFirestoreDocuments_(config, 'seasons').map(function(document) {
    return seasonCatalogEntry_(document.id, document.fields);
  }).sort(function(a, b) { return a.id.localeCompare(b.id); });
  commitFirestoreDocuments_(config, [{
    documentPath: SEASON_CATALOG_PATH,
    fields: mapFields_({seasons: seasons, updatedAt: new Date()})
  }]);
  return {rebuilt: true, documentPath: SEASON_CATALOG_PATH, seasonCount: seasons.length, seasons: seasons};
}

function publisherConfig_(requestedSeasonId) {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const seasons = publisherSeasonRegistryFromProperties_(properties);
  const seasonId = String(requestedSeasonId || properties.SEASON_ID || seasons[0].seasonId).trim();
  const selectedSeason = seasons.find(function(season) {
    return season.seasonId === seasonId;
  });
  if (!selectedSeason) {
    throw new Error('Season "' + seasonId + '" is not registered in SEASONS_JSON.');
  }
  const config = {
    projectId: String(properties.PROJECT_ID || DEFAULT_PROJECT_ID).trim(),
    seasonId: selectedSeason.seasonId,
    spreadsheetId: selectedSeason.spreadsheetId,
    seasons: seasons,
    fallbackDefaultSeasonId: String(properties.SEASON_ID || seasons[0].seasonId).trim()
  };
  if (!/^[A-Za-z0-9_-]+$/.test(config.projectId)) throw new Error('PROJECT_ID contains unsupported characters.');
  return config;
}

/**
 * Builds the admin allow-list. SEASON_ID/SPREADSHEET_ID remain the default and
 * keep existing one-season projects working; SEASONS_JSON adds switchable seasons.
 */
function publisherSeasonRegistryFromProperties_(properties) {
  const seasons = [];
  const rawRegistry = String(properties.SEASONS_JSON || '').trim();
  if (rawRegistry) {
    let parsed;
    try {
      parsed = JSON.parse(rawRegistry);
    } catch (error) {
      throw new Error('SEASONS_JSON is not valid JSON: ' + error.message);
    }
    if (!Array.isArray(parsed)) throw new Error('SEASONS_JSON must be a JSON array.');
    parsed.forEach(function(entry, index) {
      if (!entry || typeof entry !== 'object') {
        throw new Error('SEASONS_JSON entry ' + (index + 1) + ' must be an object.');
      }
      seasons.push(normalizePublisherSeason_(entry, 'SEASONS_JSON entry ' + (index + 1)));
    });
  }

  const defaultSeasonId = String(properties.SEASON_ID || '').trim();
  const defaultSpreadsheetId = String(properties.SPREADSHEET_ID || '').trim();
  if (defaultSeasonId || defaultSpreadsheetId) {
    if (!defaultSeasonId || !defaultSpreadsheetId) {
      throw new Error('SEASON_ID and SPREADSHEET_ID must either both be set or both be blank.');
    }
    const legacy = normalizePublisherSeason_({
      seasonId: defaultSeasonId,
      spreadsheetId: defaultSpreadsheetId,
      label: defaultSeasonId
    }, 'default season properties');
    const existing = seasons.find(function(season) { return season.seasonId === legacy.seasonId; });
    if (existing && existing.spreadsheetId !== legacy.spreadsheetId) {
      throw new Error('The default season has different spreadsheet IDs in SPREADSHEET_ID and SEASONS_JSON.');
    }
    if (!existing) seasons.unshift(legacy);
  }

  if (!seasons.length) {
    throw new Error('Set SEASON_ID and SPREADSHEET_ID, or add at least one entry to SEASONS_JSON.');
  }
  const seen = {};
  seasons.forEach(function(season) {
    if (seen[season.seasonId]) throw new Error('SEASONS_JSON contains the season more than once: ' + season.seasonId);
    seen[season.seasonId] = true;
  });
  return seasons;
}

function normalizePublisherSeason_(entry, sourceLabel) {
  const season = {
    seasonId: String(entry.seasonId || '').trim(),
    spreadsheetId: String(entry.spreadsheetId || '').trim(),
    label: String(entry.label || entry.seasonId || '').trim()
  };
  if (!season.seasonId || !season.spreadsheetId) {
    throw new Error(sourceLabel + ' needs both seasonId and spreadsheetId.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(season.seasonId)) throw new Error(sourceLabel + ' has an invalid seasonId.');
  if (!/^[A-Za-z0-9_-]+$/.test(season.spreadsheetId)) throw new Error(sourceLabel + ' has an invalid spreadsheetId.');
  if (season.label.length > 100) throw new Error(sourceLabel + ' label must be 100 characters or fewer.');
  return season;
}

function publisherSpreadsheetId_(value) {
  const source = String(value || '').trim();
  const urlMatch = source.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/);
  const spreadsheetId = urlMatch ? urlMatch[1] : source;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) {
    throw new Error('Paste a complete Google Sheet link or a valid spreadsheet ID.');
  }
  return spreadsheetId;
}

function upsertPublisherSeason_(seasons, requested) {
  const updated = seasons.map(function(season) {
    return {seasonId: season.seasonId, spreadsheetId: season.spreadsheetId, label: season.label};
  });
  const existing = updated.find(function(season) { return season.seasonId === requested.seasonId; });
  if (existing) {
    if (existing.spreadsheetId !== requested.spreadsheetId) {
      throw new Error('That season ID is already connected to a different spreadsheet.');
    }
    existing.label = requested.label;
    return updated;
  }
  const sheetAlreadyConnected = updated.find(function(season) {
    return season.spreadsheetId === requested.spreadsheetId;
  });
  if (sheetAlreadyConnected) {
    throw new Error('That spreadsheet is already connected as ' + sheetAlreadyConnected.label + '.');
  }
  updated.push(requested);
  return updated;
}

function currentDefaultSeasonId_(config) {
  const current = readFirestoreDocument_(config, APP_CONFIG_PATH);
  return current.exists
    ? firestoreStringField_(current.fields, 'defaultSeasonId') || config.fallbackDefaultSeasonId
    : config.fallbackDefaultSeasonId;
}

function firestoreStringField_(fields, key) {
  const field = fields && fields[key];
  return field && typeof field.stringValue === 'string' ? field.stringValue : '';
}

function publisherSeasonMetadata_(registryEntry, status, releaseLabel) {
  const seasonId = registryEntry.seasonId;
  const match = seasonId.match(/^love-is-blind-([a-z]+)-(\d+)$/);
  const code = match ? match[1] : '';
  const countries = {
    us: ['United States', 'US'], uk: ['United Kingdom', 'UK'], br: ['Brazil', 'BR'],
    se: ['Sweden', 'SE'], de: ['Germany', 'DE'], jp: ['Japan', 'JP'], mx: ['Mexico', 'MX'],
    habibi: ['United Arab Emirates', 'AE'], ar: ['Argentina', 'AR'], it: ['Italy', 'IT'],
    fr: ['France', 'FR'], pl: ['Poland', 'PL'], nl: ['Netherlands', 'NL'], za: ['South Africa', 'ZA']
  };
  const country = countries[code] || ['', code.toUpperCase()];
  return {
    id: seasonId,
    label: registryEntry.label || seasonId,
    country: country[0],
    countryCode: country[1],
    seasonNumber: match ? Number(match[2]) : 0,
    locationLabel: null,
    status: status,
    releaseLabel: String(releaseLabel || '')
  };
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

  assertUniqueSettings_(tabs.Settings);
  validateSeasonAdminPayload_(adminPayloadFromSnapshotTabs_(config.seasonId, tabs));

  const explicitStatus = setting_(tabs.Settings, 'SEASON_STATUS');
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
  return {fields: fields, snapshot: snapshot, explicitStatus: explicitStatus, status: status, tabRowCounts: tabRowCounts, approximateBytes: approximateBytes};
}

function assertPublishableSeasonStatus_(config, built) {
  if (!String(built && built.explicitStatus || '').trim()) {
    throw new Error('Season "' + config.seasonId + '" cannot be published because SEASON_STATUS is empty. Choose Upcoming, Live, or Completed explicitly.');
  }
  if (!['upcoming', 'live', 'completed'].includes(String(built.status || '').toLowerCase())) {
    throw new Error('Season "' + config.seasonId + '" cannot be published because SEASON_STATUS must be Upcoming, Live, or Completed.');
  }
}

function assertUniqueSettings_(settings) {
  const seen = {};
  (settings || []).forEach(function(row) {
    const key = String(row && row.key || '').trim();
    if (!key) return;
    if (seen[key]) throw new Error('Settings contains the key more than once: ' + key + '. Remove the duplicate before previewing.');
    seen[key] = true;
  });
}

function snapshotRecordValue_(record, header) {
  const wanted = normalizedAdminHeader_(header);
  const key = Object.keys(record || {}).find(function(candidate) {
    return normalizedAdminHeader_(candidate) === wanted;
  });
  return key == null ? '' : record[key];
}

function adminPayloadFromSnapshotTabs_(seasonId, tabs) {
  const settingValues = Object.assign({}, ADMIN_SETTING_DEFAULTS);
  (tabs.Settings || []).forEach(function(row) {
    const key = String(row && row.key || '').trim();
    if (key) settingValues[key] = row.value == null ? '' : String(row.value);
  });
  const mapRows = function(tabName, tableKey) {
    const headers = ADMIN_TABLE_HEADERS[tableKey];
    const keys = ADMIN_TABLE_KEYS[tableKey];
    return (tabs[tabName] || []).map(function(row) {
      const result = {};
      headers.forEach(function(header, index) {
        result[keys[index]] = snapshotRecordValue_(row, header);
      });
      return result;
    });
  };
  return {
    seasonId: seasonId,
    settings: settingValues,
    cast: mapRows('Cast', 'cast'),
    couples: mapRows('Couples', 'couples'),
    datingResults: mapRows('Dating Results', 'datingResults'),
    reunionResults: mapRows('Reunion Results', 'reunionResults'),
    retroEvents: mapRows('Retro Events', 'retroEvents')
  };
}

function seasonReleaseHash_(built) {
  const canonical = Object.assign({}, built && built.snapshot || {});
  delete canonical.publishedAt;
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(canonical),
    Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function previewHashPropertyKey_(seasonId) {
  return PREVIEW_HASH_PROPERTY_PREFIX + seasonId;
}

function recordPreviewHash_(seasonId, releaseHash) {
  PropertiesService.getScriptProperties().setProperty(previewHashPropertyKey_(seasonId), releaseHash);
}

function assertMatchesLatestPreview_(seasonId, releaseHash) {
  const previewHash = PropertiesService.getScriptProperties().getProperty(previewHashPropertyKey_(seasonId));
  if (!previewHash) {
    throw new Error('Preview this season before publishing it. No approved preview is recorded.');
  }
  if (previewHash !== releaseHash) {
    throw new Error('The season sheet changed after its last preview. Preview the current sheet again before publishing.');
  }
}

function clearPreviewHash_(seasonId) {
  PropertiesService.getScriptProperties().deleteProperty(previewHashPropertyKey_(seasonId));
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

function seasonReleaseComparison_(built, current) {
  const pending = built.snapshot || {};
  const published = current && current.exists ? plainFirestoreFields_(current.fields || {}) : null;
  const pendingSettings = snapshotSettings_(pending);
  const publishedSettings = snapshotSettings_(published);
  const settings = RELEASE_COMPARISON_SETTINGS.map(function(key) {
    const pendingValue = key === 'SEASON_STATUS' ? valueOrNull_(pending.status) : valueOrNull_(pendingSettings[key]);
    const publishedValue = key === 'SEASON_STATUS' ? valueOrNull_(published && published.status) : valueOrNull_(publishedSettings[key]);
    return {
      key: key,
      published: publishedValue,
      pending: pendingValue,
      changed: !!published && String(publishedValue) !== String(pendingValue)
    };
  });
  const rowCounts = ['Cast', 'Couples'].map(function(tabName) {
    const publishedCount = published && Array.isArray(published[tabName]) ? published[tabName].length : null;
    const pendingCount = Array.isArray(pending[tabName]) ? pending[tabName].length : 0;
    return {
      tab: tabName,
      published: publishedCount,
      pending: pendingCount,
      changed: publishedCount !== null && publishedCount !== pendingCount
    };
  });
  const warnings = [];
  const publishedAvailable = Number(publishedSettings.AVAILABLE_THROUGH_EP);
  const pendingAvailable = Number(pendingSettings.AVAILABLE_THROUGH_EP);
  if (published && Number.isFinite(publishedAvailable) && Number.isFinite(pendingAvailable) && pendingAvailable < publishedAvailable) {
    warnings.push('AVAILABLE_THROUGH_EP moves backward from ' + publishedAvailable + ' to ' + pendingAvailable + '. Publishing will revoke pending episode access; confirmed watched progress is preserved.');
  }
  const pendingCastComplete = String(pendingSettings.CAST_COMPLETE).toUpperCase() === 'TRUE';
  const pendingAllowsIncompleteCast = String(pendingSettings.ALLOW_INCOMPLETE_CAST).toUpperCase() === 'TRUE';
  if (pendingAllowsIncompleteCast && !pendingCastComplete) {
    warnings.push('Incomplete-cast predictions are enabled. Once the season is Live, cast members and couples added later will change the prediction field and may change against-the-grain scoring.');
  }
  return {publishedExists: !!published, settings: settings, rowCounts: rowCounts, warnings: warnings};
}

function snapshotSettings_(snapshot) {
  const result = {};
  if (!snapshot || !Array.isArray(snapshot.Settings)) return result;
  snapshot.Settings.forEach(function(row) {
    if (row && row.key != null) result[String(row.key)] = row.value == null ? '' : row.value;
  });
  return result;
}

function valueOrNull_(value) {
  return value == null ? null : value;
}

function plainFirestoreFields_(fields) {
  return Object.fromEntries(Object.keys(fields || {}).map(function(key) {
    return [key, plainFirestoreValue_(fields[key])];
  }));
}

function plainFirestoreValue_(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
  if (value.arrayValue) return (value.arrayValue.values || []).map(plainFirestoreValue_);
  if (value.mapValue) return plainFirestoreFields_(value.mapValue.fields || {});
  return null;
}

function seasonCatalogEntry_(seasonId, fields) {
  const snapshot = plainFirestoreFields_(fields || {});
  const settings = snapshotSettings_(snapshot);
  const publishedAt = snapshot.publishedAt ? new Date(snapshot.publishedAt) : null;
  return {
    id: String(snapshot.seasonId || seasonId || ''),
    status: String(snapshot.status || 'upcoming'),
    sourceSheetId: String(snapshot.sourceSheetId || ''),
    releaseLabel: String(settings.RELEASE_LABEL || ''),
    publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null
  };
}

function seasonCatalogFieldsWithEntry_(currentCatalog, entry) {
  const current = currentCatalog && currentCatalog.exists
    ? plainFirestoreFields_(currentCatalog.fields || {})
    : {};
  const seasons = (Array.isArray(current.seasons) ? current.seasons : [])
    .filter(function(season) { return season && season.id && season.id !== entry.id; })
    .concat([entry])
    .sort(function(a, b) { return String(a.id).localeCompare(String(b.id)); });
  return mapFields_({seasons: seasons, updatedAt: new Date()});
}

function backupDocumentPath_(seasonId, reason, timestamp) {
  return BACKUP_COLLECTION + '/' + seasonId + '__' + (timestamp || timestampId_()) + '__' + reason;
}

function timestampId_() {
  return Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd_HHmmss_SSS');
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

function latestAppConfigBackupPropertyKey_(seasonId) {
  return APP_CONFIG_BACKUP_PROPERTY_PREFIX + seasonId;
}

function latestAppConfigBackupPath_(seasonId) {
  return PropertiesService.getScriptProperties().getProperty(latestAppConfigBackupPropertyKey_(seasonId)) || '';
}

function setLatestAppConfigBackupPath_(seasonId, path) {
  PropertiesService.getScriptProperties().setProperty(latestAppConfigBackupPropertyKey_(seasonId), path);
}

function clearLatestAppConfigBackupPath_(seasonId) {
  PropertiesService.getScriptProperties().deleteProperty(latestAppConfigBackupPropertyKey_(seasonId));
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

function listFirestoreDocuments_(config, collectionPath) {
  const documents = [];
  let pageToken = '';
  do {
    const url = firestoreDocumentUrl_(config.projectId, collectionPath) +
      '?pageSize=100' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
      muteHttpExceptions: true
    });
    assertFirestoreResponse_(response, 'list ' + collectionPath);
    const payload = JSON.parse(response.getContentText() || '{}');
    (payload.documents || []).forEach(function(document) {
      const name = String(document.name || '');
      documents.push({id: decodeURIComponent(name.split('/').pop() || ''), fields: document.fields || {}});
    });
    pageToken = String(payload.nextPageToken || '');
  } while (pageToken);
  return documents;
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

function commitFirestoreDocuments_(config, documents) {
  const writes = (documents || []).map(function(document) {
    const approximateBytes = Utilities.newBlob(JSON.stringify(document.fields)).getBytes().length;
    if (approximateBytes > MAX_SNAPSHOT_BYTES) {
      throw new Error('Refusing to write an approximately ' + approximateBytes + '-byte Firestore document.');
    }
    return {
      update: {
        name: firestoreDocumentName_(config.projectId, document.documentPath),
        fields: document.fields
      }
    };
  });
  if (!writes.length) throw new Error('No Firestore documents were supplied for the atomic release.');
  const response = UrlFetchApp.fetch(firestoreCommitUrl_(config.projectId), {
    method: 'post',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    payload: JSON.stringify({writes: writes}),
    muteHttpExceptions: true
  });
  assertFirestoreResponse_(response, 'commit release documents');
}

function firestoreDocumentUrl_(projectId, documentPath) {
  const encodedPath = String(documentPath).split('/').map(encodeURIComponent).join('/');
  return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) +
    '/databases/(default)/documents/' + encodedPath;
}

function firestoreDocumentName_(projectId, documentPath) {
  return 'projects/' + projectId + '/databases/(default)/documents/' + String(documentPath);
}

function firestoreCommitUrl_(projectId) {
  return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) +
    '/databases/(default)/documents:commit';
}

function assertFirestoreResponse_(response, operation) {
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Firestore could not ' + operation + ' (' + code + '): ' + response.getContentText());
  }
}

function adminTableKeyForTab_(tabName) {
  return {
    'Cast': 'cast',
    'Couples': 'couples',
    'Dating Results': 'datingResults',
    'Reunion Results': 'reunionResults',
    'Retro Events': 'retroEvents'
  }[tabName] || '';
}

function normalizedAdminHeader_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readAdminTable_(spreadsheet, tabName, optional) {
  const sheet = spreadsheet.getSheetByName(tabName);
  if (!sheet && optional) return [];
  if (!sheet) throw new Error('Missing required sheet tab: ' + tabName);
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return [];
  const headerIndexes = {};
  values[0].forEach(function(header, index) {
    headerIndexes[normalizedAdminHeader_(header)] = index;
  });
  if (tabName === 'Settings') {
    return values.slice(1).filter(adminRowHasValue_).map(function(row) {
      return {
        key: String(row[headerIndexes.key] || '').trim(),
        value: String(row[headerIndexes.value] || '').trim(),
        notes: String(row[headerIndexes.notes] || '').trim()
      };
    }).filter(function(row) { return row.key; });
  }
  const tableKey = adminTableKeyForTab_(tabName);
  const headers = ADMIN_TABLE_HEADERS[tableKey];
  const keys = ADMIN_TABLE_KEYS[tableKey];
  return values.slice(1).filter(adminRowHasValue_).map(function(row) {
    const record = {};
    headers.forEach(function(header, index) {
      const column = headerIndexes[normalizedAdminHeader_(header)];
      record[keys[index]] = column == null ? '' : String(row[column] || '').trim();
    });
    return record;
  });
}

function adminRowHasValue_(row) {
  return row.some(function(value) { return String(value || '').trim() !== ''; });
}

function writeAdminTable_(spreadsheet, tabName, headers, records, optional) {
  let sheet = spreadsheet.getSheetByName(tabName);
  if (!sheet && optional) sheet = spreadsheet.insertSheet(tabName);
  if (!sheet) throw new Error('Missing required sheet tab: ' + tabName);
  const tableKey = adminTableKeyForTab_(tabName);
  const keys = ADMIN_TABLE_KEYS[tableKey];
  const values = [headers].concat(records.map(function(record) {
    return keys.map(function(key) { return String(record[key] == null ? '' : record[key]); });
  }));
  sheet.clearContents();
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
}

function mergeAdminSettings_(spreadsheet, settings) {
  const sheet = spreadsheet.getSheetByName('Settings');
  if (!sheet) throw new Error('Missing required sheet tab: Settings');
  const existing = readAdminTable_(spreadsheet, 'Settings');
  const byKey = {};
  existing.forEach(function(row) { byKey[row.key] = row; });
  ADMIN_EDITABLE_SETTINGS.forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) return;
    if (!byKey[key]) {
      byKey[key] = {key: key, value: '', notes: ''};
      existing.push(byKey[key]);
    }
    byKey[key].value = String(settings[key]);
  });
  const values = [['key', 'value', 'Notes']].concat(existing.map(function(row) {
    return [row.key, row.value, row.notes || ''];
  }));
  sheet.clearContents();
  sheet.getRange(1, 1, values.length, 3).setValues(values);
  sheet.setFrozenRows(1);
}

function cleanAdminString_(value, maxLength) {
  const cleaned = String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length > (maxLength || 200)) throw new Error('A field is longer than the admin limit.');
  return cleaned;
}

function cleanAdminBoolean_(value, allowBlank) {
  if (allowBlank && (value == null || value === '')) return '';
  if (value === true || String(value).toUpperCase() === 'TRUE') return 'TRUE';
  if (value === false || String(value).toUpperCase() === 'FALSE') return 'FALSE';
  throw new Error('Expected a true/false value.');
}

function cleanAdminEpisode_(value, label, allowBlank) {
  if (allowBlank && (value == null || String(value).trim() === '')) return '';
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(label + ' must be an episode from 1 to 100.');
  }
  return String(parsed);
}

function cleanAdminNumber_(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(label + ' must be between ' + minimum + ' and ' + maximum + '.');
  }
  return String(parsed);
}

function validateSeasonAdminPayload_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The season-admin form was not received correctly.');
  }
  ['cast', 'couples', 'datingResults', 'reunionResults', 'retroEvents'].forEach(function(key) {
    if (!Array.isArray(payload[key])) throw new Error('Missing admin section: ' + key + '.');
    if (payload[key].length > 250) throw new Error('The ' + key + ' section has too many rows.');
  });

  const settings = validateAdminSettings_(payload.settings || {});
  const cast = [];
  const castNames = new Set();
  payload.cast.forEach(function(raw, index) {
    const name = cleanAdminString_(raw.name, 80);
    const gender = cleanAdminString_(raw.gender, 1).toUpperCase();
    if (!name && !gender) return;
    if (!name) throw new Error('Cast row ' + (index + 1) + ' needs a name.');
    if (!['M', 'F'].includes(gender)) throw new Error(name + ' needs gender M or F.');
    const key = name.toLowerCase();
    if (castNames.has(key)) throw new Error('Cast name is duplicated: ' + name + '.');
    castNames.add(key);
    cast.push({gender: gender, name: name});
  });

  const couples = [];
  const coupleIds = new Set();
  payload.couples.forEach(function(raw, index) {
    const id = cleanAdminString_(raw.id, 100);
    const him = cleanAdminString_(raw.him, 80);
    const her = cleanAdminString_(raw.her, 80);
    if (!id && !him && !her) return;
    if (!id || !him || !her) throw new Error('Engagement row ' + (index + 1) + ' needs an ID and both cast members.');
    if (him === her) throw new Error(id + ' cannot pair one cast member with themselves.');
    if (!castNames.has(him.toLowerCase()) || !castNames.has(her.toLowerCase())) {
      throw new Error(id + ' must use exact names from the Cast section.');
    }
    if (coupleIds.has(id)) throw new Error('Couple ID is duplicated: ' + id + '.');
    coupleIds.add(id);
    const wedding = cleanAdminString_(raw.wedding, 20);
    if (wedding && !['married', 'saysNo', 'calledOff', 'notShown'].includes(wedding)) {
      throw new Error(id + ' has an unsupported wedding outcome.');
    }
    const who = cleanAdminString_(raw.whoSaysNo, 10);
    if (who && !['him', 'her'].includes(who)) throw new Error(id + ' must use him or her for who ended it.');
    if (['saysNo', 'calledOff'].includes(wedding) && !who) throw new Error(id + ' needs the person who ended it.');
    couples.push({
      id: id, him: him, her: her,
      engagedEp: cleanAdminEpisode_(raw.engagedEp, id + ' engagement episode', true),
      wedding: wedding, whoSaysNo: who,
      breakupEp: cleanAdminEpisode_(raw.breakupEp, id + ' breakup episode', true),
      settledEp: cleanAdminEpisode_(raw.settledEp, id + ' settled episode', true),
      togetherNow: cleanAdminBoolean_(raw.togetherNow, true),
      lockEp: cleanAdminEpisode_(raw.lockEp, id + ' lock episode', true),
      podsEligible: cleanAdminBoolean_(raw.podsEligible, true),
      datingEligible: cleanAdminBoolean_(raw.datingEligible, true),
      reunionStatusEligible: cleanAdminBoolean_(raw.reunionStatusEligible, true)
    });
  });

  const retreatStart = Number(settings.RETREAT_START_EP);
  const retreatEnd = Number(settings.RETREAT_END_EP);
  const datingResults = [];
  payload.datingResults.forEach(function(raw, index) {
    const market = cleanAdminString_(raw.market, 20).toLowerCase();
    const coupleId = cleanAdminString_(raw.coupleId, 100);
    const person = cleanAdminString_(raw.person, 80);
    if (!market && !coupleId && !person) return;
    if (!['sex', 'flirt', 'breakup'].includes(market)) throw new Error('Retreat result row ' + (index + 1) + ' has an unsupported outcome.');
    const episode = cleanAdminEpisode_(raw.episode, 'Retreat result episode', false);
    if (Number(episode) < retreatStart || Number(episode) > retreatEnd) {
      throw new Error('Retreat results must fall between Episodes ' + retreatStart + ' and ' + retreatEnd + '.');
    }
    if (market === 'flirt') {
      if (!person || !castNames.has(person.toLowerCase())) throw new Error('A flirt result must use an exact cast name.');
    } else if (!coupleIds.has(coupleId)) {
      throw new Error('A ' + market + ' result must use an existing couple.');
    }
    datingResults.push({market: market, coupleId: market === 'flirt' ? '' : coupleId, episode: episode, person: market === 'flirt' ? person : '', confirmed: cleanAdminBoolean_(raw.confirmed, false)});
  });

  const reunionResults = [];
  payload.reunionResults.forEach(function(raw, index) {
    const market = cleanAdminString_(raw.market, 20).toLowerCase();
    const target = cleanAdminString_(raw.target, 180);
    const value = cleanAdminString_(raw.value, 80);
    const notes = cleanAdminString_(raw.notes, 300);
    if (!market && !target && !value) return;
    if (!['still', 'back', 'newcouple', 'lifeupdate', 'absent'].includes(market)) throw new Error('Reunion row ' + (index + 1) + ' has an unsupported outcome.');
    if (['still', 'back'].includes(market) && !coupleIds.has(target)) throw new Error('A Reunion relationship result must use an existing couple.');
    if (market === 'newcouple') {
      const people = target.split('|');
      if (people.length !== 2 || !people.every(function(name) { return castNames.has(name.toLowerCase()); })) throw new Error('A new Reunion couple must contain two exact cast names.');
    }
    if (['lifeupdate', 'absent'].includes(market) && !castNames.has(target.toLowerCase())) throw new Error('The Reunion castmate must use an exact Cast name.');
    if (market === 'lifeupdate' && !['newPartner', 'newBaby'].includes(value)) throw new Error('Choose a supported major-life-update result.');
    if (['still', 'back'].includes(market) && !['TRUE', 'FALSE'].includes(value.toUpperCase())) throw new Error('Relationship status results must be true or false.');
    reunionResults.push({market: market, target: target, value: ['still', 'back'].includes(market) ? value.toUpperCase() : value, notes: notes});
  });

  const retroEvents = payload.retroEvents.map(function(raw, index) {
    const market = cleanAdminString_(raw.market, 20).toLowerCase();
    const target = cleanAdminString_(raw.target, 180);
    const note = cleanAdminString_(raw.note, 300);
    if (!market && !target && !note) return null;
    if (!['pods', 'sex', 'flirt', 'breakup', 'still', 'void'].includes(market)) throw new Error('Correction row ' + (index + 1) + ' has an unsupported market.');
    if (!target || !note) throw new Error('Every correction needs a target and an explanatory note.');
    return {
      market: market,
      target: target,
      voidMarket: cleanAdminString_(raw.voidMarket, 20).toLowerCase(),
      appliesPhase: cleanAdminString_(raw.appliesPhase, 20).toLowerCase(),
      revealedEp: cleanAdminEpisode_(raw.revealedEp, 'Correction reveal episode', false),
      note: note,
      confirmed: cleanAdminBoolean_(raw.confirmed, false)
    };
  }).filter(Boolean);

  return {settings: settings, cast: cast, couples: couples, datingResults: datingResults, reunionResults: reunionResults, retroEvents: retroEvents};
}

function validateAdminSettings_(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Season settings are missing.');
  const settings = {};
  ADMIN_EDITABLE_SETTINGS.forEach(function(key) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) settings[key] = cleanAdminString_(raw[key], 180);
  });
  const status = String(settings.SEASON_STATUS || '').trim();
  const normalizedStatus = status === 'comingSoon' ? 'upcoming' : status;
  if (!['upcoming', 'live', 'completed'].includes(normalizedStatus)) throw new Error('Choose Upcoming, Live, or Completed for the season status.');
  settings.SEASON_STATUS = normalizedStatus;
  const configVersion = cleanAdminNumber_(settings.CONFIG_VERSION || 1, 'Configuration version', 1, 2);
  if (!['1', '2'].includes(configVersion)) throw new Error('Configuration version must be Legacy v1 or Current v2.');
  settings.CONFIG_VERSION = configVersion;
  settings.AVAILABLE_THROUGH_EP = cleanAdminNumber_(settings.AVAILABLE_THROUGH_EP || 0, 'Available-through episode', 0, 100);

  const numberKeys = [
    'PODS_START_EP', 'PODS_END_EP', 'DATING_START_EP', 'DATING_END_EP', 'RETREAT_START_EP', 'RETREAT_END_EP',
    'WEDDINGS_START_EP', 'WEDDINGS_END_EP', 'REUNION_START_EP', 'REUNION_END_EP',
    'PODS_BUDGET', 'PODS_CAP', 'DATING_BUDGET', 'DATING_CAP', 'WEDDINGS_BUDGET', 'WEDDINGS_CAP', 'REUNION_BUDGET', 'REUNION_CAP',
    'DATING_SEX_MULT', 'DATING_FLIRT_MULT', 'DATING_BREAKUP_MULT',
    'WEDDINGS_MARRIED_MULT', 'WEDDINGS_SAYS_NO_MULT', 'WEDDINGS_CALLED_OFF_MULT', 'WEDDINGS_LEAD_STEP', 'WEDDINGS_LEAD_CAP',
    'REUNION_STILL_MULT', 'REUNION_SPLIT_MULT', 'REUNION_MARRIED_SPLIT_MULT', 'REUNION_BACK_MULT',
    'REUNION_NEW_COUPLE_MULT', 'REUNION_LIFE_UPDATE_MULT', 'REUNION_ABSENT_MULT'
  ];
  numberKeys.forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(settings, key) || settings[key] === '') return;
    const maximum = key.includes('BUDGET') || key.includes('CAP') ? 10000 : (key.includes('_EP') ? 100 : 100);
    settings[key] = cleanAdminNumber_(settings[key], key, key.includes('_EP') ? 1 : 0, maximum);
  });
  ['CAST_COMPLETE', 'ALLOW_INCOMPLETE_CAST', 'BOUNDARIES_LIVE', 'PODS_BOUNDARY_FINAL', 'DATING_BOUNDARY_FINAL', 'WEDDINGS_BOUNDARY_FINAL', 'REUNION_BOUNDARY_FINAL', 'PODS_RESULTS_READY', 'DATING_RESULTS_READY', 'WEDDINGS_RESULTS_READY', 'REUNION_RESULTS_READY'].forEach(function(key) {
    settings[key] = cleanAdminBoolean_(settings[key], false);
  });

  const starts = [Number(settings.PODS_START_EP), Number(settings.DATING_START_EP), Number(settings.WEDDINGS_START_EP), Number(settings.REUNION_START_EP)];
  const ends = [Number(settings.PODS_END_EP), Number(settings.DATING_END_EP), Number(settings.WEDDINGS_END_EP), Number(settings.REUNION_END_EP)];
  starts.forEach(function(start, index) {
    if (!Number.isFinite(start) || !Number.isFinite(ends[index]) || ends[index] <= start) throw new Error('Each phase end must be later than its start.');
    if (index > 0 && (start <= starts[index - 1] || start > ends[index - 1])) throw new Error('Phase starts must remain chronological and overlap or meet the previous phase.');
  });
  const retreatStart = Number(settings.RETREAT_START_EP), retreatEnd = Number(settings.RETREAT_END_EP);
  if (retreatStart < starts[1] || retreatEnd < retreatStart || retreatEnd > ends[1]) throw new Error('The retreat scoring window must sit inside the Dating phase.');
  if (Number(settings.AVAILABLE_THROUGH_EP) > ends[3]) throw new Error('Available-through episode cannot exceed the Reunion end.');
  return settings;
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
