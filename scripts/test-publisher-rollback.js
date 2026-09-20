const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'season-publisher','Code.gs'),'utf8');
const properties=new Map();
let timestampSequence=0;
const context={
  console:{log:()=>{},warn:()=>{},error:()=>{}},
  Date,
  Utilities:{
    formatDate:()=>`20260910_120000_00${++timestampSequence}`,
    newBlob:value=>({getBytes:()=>Buffer.from(value)})
  },
  HtmlService:{},SpreadsheetApp:{},LockService:{},UrlFetchApp:{},ScriptApp:{},
  PropertiesService:{getScriptProperties:()=>({
    getProperty:key=>properties.get(key)||null,
    setProperty:(key,value)=>properties.set(key,value),
    deleteProperty:key=>properties.delete(key)
  })}
};
vm.createContext(context);
vm.runInContext(`${source}\nthis.__publisher={rollbackSeasonSnapshot};`,context);

const seasonId='love-is-blind-test-2';
const seasonPath=`seasons/${seasonId}`;
const originalBackupPath=`seasonSnapshotBackups/${seasonId}__original__publish`;
const appConfigPath='appConfig/public';
const originalAppConfigBackupPath=`appConfigBackups/${seasonId}__original__publish`;
const originalFields={status:{stringValue:'live'},publishedAt:{stringValue:'release-one'}};
const currentFields={status:{stringValue:'live'},publishedAt:{stringValue:'release-two'}};
const originalAppConfigFields={defaultSeasonId:{stringValue:seasonId},defaultSeasonLabel:{stringValue:'Release one'}};
const currentAppConfigFields={defaultSeasonId:{stringValue:seasonId},defaultSeasonLabel:{stringValue:'Release two'}};
const documents=new Map([
  [seasonPath,currentFields],
  [originalBackupPath,originalFields],
  [appConfigPath,currentAppConfigFields],
  [originalAppConfigBackupPath,originalAppConfigFields]
]);
properties.set(`LAST_BACKUP_PATH__${seasonId}`,originalBackupPath);
properties.set(`LAST_APP_CONFIG_BACKUP_PATH__${seasonId}`,originalAppConfigBackupPath);

context.publisherConfig_=()=>({projectId:'test-project',seasonId,fallbackDefaultSeasonId:seasonId});
context.readFirestoreDocument_=(_config,documentPath)=>documents.has(documentPath)
  ? {exists:true,fields:documents.get(documentPath)}
  : {exists:false,fields:{}};
let transactionCount=0;
context.commitFirestoreDocuments_=(_config,writes)=>{
  transactionCount++;
  const pending=new Map(documents);
  writes.forEach(write=>pending.set(write.documentPath,write.fields));
  documents.clear();
  pending.forEach((fields,documentPath)=>documents.set(documentPath,fields));
};

const first=context.__publisher.rollbackSeasonSnapshot(seasonId);
assert.equal(first.rolledBack,true);
assert.equal(first.restoredFrom,originalBackupPath);
assert.match(first.previousLiveSavedTo,/__rollback$/);
assert.deepEqual(documents.get(seasonPath),originalFields,'Rollback must restore the recorded season snapshot exactly.');
assert.deepEqual(documents.get(first.previousLiveSavedTo),currentFields,'Rollback must preserve the displaced live snapshot.');
assert.equal(properties.get(`LAST_BACKUP_PATH__${seasonId}`),first.previousLiveSavedTo,'The rescue copy must become the next rollback target.');
assert.equal(first.appConfigRestoredFrom,originalAppConfigBackupPath);
assert.equal(first.standingsRepair.status,'scheduled','Rollback must report the standings repair triggered by the season write.');
assert.equal(first.standingsRepair.source,'season-update-trigger');
assert.deepEqual(documents.get(appConfigPath),originalAppConfigFields,'Rollback must restore matching default-season routing metadata.');
assert.deepEqual(documents.get(first.previousAppConfigSavedTo),currentAppConfigFields,'Rollback must preserve the displaced routing metadata.');
assert.equal(properties.get(`LAST_APP_CONFIG_BACKUP_PATH__${seasonId}`),first.previousAppConfigSavedTo,'The routing rescue copy must become the next rollback target.');
assert.equal(transactionCount,1,'Season and routing rollback writes must share one atomic commit.');

const second=context.__publisher.rollbackSeasonSnapshot(seasonId);
assert.equal(second.restoredFrom,first.previousLiveSavedTo);
assert.notEqual(second.previousLiveSavedTo,first.previousLiveSavedTo);
assert.deepEqual(documents.get(seasonPath),currentFields,'A second rollback must reverse the first rollback.');
assert.deepEqual(documents.get(second.previousLiveSavedTo),originalFields,'The second rollback must preserve the version it displaced.');
assert.deepEqual(documents.get(appConfigPath),currentAppConfigFields,'A second rollback must reverse the routing metadata restoration.');
assert.deepEqual(documents.get(second.previousAppConfigSavedTo),originalAppConfigFields,'The second rollback must preserve the routing metadata it displaced.');

properties.delete(`LAST_BACKUP_PATH__${seasonId}`);
const transactionsBeforeMissingBackup=transactionCount;
assert.throws(()=>context.__publisher.rollbackSeasonSnapshot(seasonId),/No rollback backup/);
assert.equal(transactionCount,transactionsBeforeMissingBackup,'A missing backup must fail before an atomic write.');

console.log('Publisher rollback mechanics passed.');
