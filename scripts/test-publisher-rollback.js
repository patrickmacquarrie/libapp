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
  Utilities:{formatDate:()=>`20260910_120000_00${++timestampSequence}`},
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
const originalFields={status:{stringValue:'live'},publishedAt:{stringValue:'release-one'}};
const currentFields={status:{stringValue:'live'},publishedAt:{stringValue:'release-two'}};
const documents=new Map([
  [seasonPath,currentFields],
  [originalBackupPath,originalFields]
]);
properties.set(`LAST_BACKUP_PATH__${seasonId}`,originalBackupPath);

context.publisherConfig_=()=>({projectId:'test-project',seasonId});
context.readFirestoreDocument_=(_config,documentPath)=>documents.has(documentPath)
  ? {exists:true,fields:documents.get(documentPath)}
  : {exists:false,fields:{}};
context.writeFirestoreDocument_=(_config,documentPath,fields)=>documents.set(documentPath,fields);

const first=context.__publisher.rollbackSeasonSnapshot(seasonId);
assert.equal(first.rolledBack,true);
assert.equal(first.restoredFrom,originalBackupPath);
assert.match(first.previousLiveSavedTo,/__rollback$/);
assert.deepEqual(documents.get(seasonPath),originalFields,'Rollback must restore the recorded season snapshot exactly.');
assert.deepEqual(documents.get(first.previousLiveSavedTo),currentFields,'Rollback must preserve the displaced live snapshot.');
assert.equal(properties.get(`LAST_BACKUP_PATH__${seasonId}`),first.previousLiveSavedTo,'The rescue copy must become the next rollback target.');

const second=context.__publisher.rollbackSeasonSnapshot(seasonId);
assert.equal(second.restoredFrom,first.previousLiveSavedTo);
assert.notEqual(second.previousLiveSavedTo,first.previousLiveSavedTo);
assert.deepEqual(documents.get(seasonPath),currentFields,'A second rollback must reverse the first rollback.');
assert.deepEqual(documents.get(second.previousLiveSavedTo),originalFields,'The second rollback must preserve the version it displaced.');

properties.delete(`LAST_BACKUP_PATH__${seasonId}`);
assert.throws(()=>context.__publisher.rollbackSeasonSnapshot(seasonId),/No rollback backup/);

console.log('Publisher rollback mechanics passed.');
