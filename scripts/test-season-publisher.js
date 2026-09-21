const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');

const source=fs.readFileSync(path.join(__dirname,'season-publisher','Code.gs'),'utf8');
const scriptProperties=new Map();
const context={
  console:{log:()=>{},warn:()=>{},error:()=>{}},
  Date,
  Utilities:{
    formatDate:()=> '20260909_120000_000',
    newBlob:value=>({getBytes:()=>Buffer.from(value)}),
    DigestAlgorithm:{SHA_256:'SHA_256'},
    Charset:{UTF_8:'UTF_8'},
    computeDigest:(_algorithm,value)=>Array.from(crypto.createHash('sha256').update(value).digest())
  },
  HtmlService:{},SpreadsheetApp:{},LockService:{},UrlFetchApp:{},ScriptApp:{},
  PropertiesService:{getScriptProperties:()=>({
    getProperty:key=>scriptProperties.get(key)||null,
    setProperty:(key,value)=>scriptProperties.set(key,value),
    deleteProperty:key=>scriptProperties.delete(key)
  })}
};
vm.createContext(context);
vm.runInContext(`${source}\nthis.__publisher={
  setDefaultSeasonFromAdmin,previewSeasonSnapshot,publishSeasonSnapshot,publishSeasonFromAdmin,
  backupDocumentPath_,timestampId_,seasonReleaseHash_,assertUniqueSettings_,
  adminPayloadFromSnapshotTabs_,validateSeasonAdminPayload_,buildSeasonSnapshot_,commitFirestoreDocuments_,
  rebuildSeasonCatalog,seasonCatalogEntry_,mapFields_
};`,context);

const seasonId='love-is-blind-test-2';
const config={
  projectId:'test-project',seasonId,spreadsheetId:'sheet-2',fallbackDefaultSeasonId:'love-is-blind-test-1',
  seasons:[{seasonId,label:'Test Season 2'}]
};
const transactions=[];
context.publisherConfig_=()=>config;
let commitRequest=null;
context.ScriptApp={getOAuthToken:()=> 'test-token'};
context.UrlFetchApp={fetch:(url,options)=>{
  commitRequest={url,options};
  return {getResponseCode:()=>200,getContentText:()=>'{"writeResults":[]}'};
}};
context.__publisher.commitFirestoreDocuments_(config,[{documentPath:`seasons/${seasonId}`,fields:{status:{stringValue:'live'}}}]);
assert.equal(commitRequest.url,'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents:commit');
const committedPayload=JSON.parse(commitRequest.options.payload);
assert.equal(committedPayload.writes[0].update.name,`projects/test-project/databases/(default)/documents/seasons/${seasonId}`);
assert.equal(commitRequest.options.headers.Authorization,'Bearer test-token');
context.readFirestoreDocument_=(_config,documentPath)=>{
  if(documentPath===`seasons/${seasonId}`)return {exists:true,fields:{status:{stringValue:'live'}}};
  if(documentPath==='appConfig/public')return {exists:true,fields:{defaultSeasonId:{stringValue:'love-is-blind-test-1'}}};
  if(documentPath==='appConfig/seasonCatalog')return {exists:false,fields:{}};
  throw new Error(`Unexpected read: ${documentPath}`);
};
context.SpreadsheetApp={openById:()=>({})};
context.readAdminTable_=()=>[{key:'RELEASE_LABEL',value:'Fall test'}];
context.publisherSeasonMetadata_=()=>({id:seasonId,label:'Test Season 2'});
context.commitFirestoreDocuments_=(_config,documents)=>transactions.push(documents);
context.mapFields_=value=>value;
context.getSeasonAdminData=()=>({seasonId});

const result=context.__publisher.setDefaultSeasonFromAdmin(seasonId);
assert.equal(result.changed,true);
assert.equal(result.previousConfigBackupPath,'appConfigBackups/default__20260909_120000_000');
assert.deepEqual(Array.from(transactions[0],write=>write.documentPath),[
  'appConfigBackups/default__20260909_120000_000',
  'appConfig/public'
]);
assert.equal(transactions[0][1].fields.defaultSeasonId,seasonId);
context.mapFields_=context.__publisher.mapFields_;
assert.equal(context.__publisher.backupDocumentPath_(seasonId,'publish'),'seasonSnapshotBackups/love-is-blind-test-2__20260909_120000_000__publish');
assert.equal(context.__publisher.timestampId_(),'20260909_120000_000');

assert.throws(
  ()=>context.__publisher.assertUniqueSettings_([{key:'PODS_CAP'},{key:'PODS_CAP'}]),
  /more than once/
);

const invalidSheetRows={
  Cast:[['Gender','Name'],['M','Alex'],['F','Sam']],
  Couples:[['ID','Him','Her']],
  'Dating Results':[['Market','Couple ID','Episode','Person','Confirmed']],
  'Reunion Results':[['Market','Couple/Person ID or Name','Value','Notes']],
  Settings:[['key','value','Notes'],['SEASON_STATUS','live',''],['PODS_END_EP','0','']]
};
context.SpreadsheetApp={openById:()=>({getSheetByName:name=>invalidSheetRows[name]
  ? {getDataRange:()=>({getDisplayValues:()=>invalidSheetRows[name]})}
  : null})};
assert.throws(
  ()=>context.__publisher.buildSeasonSnapshot_(config),
  /PODS_END_EP must be between 1 and 100/
);

const releaseOne={
  fields:{status:{stringValue:'live'}},
  snapshot:{seasonId,status:'live',publishedAt:new Date('2026-09-09T12:00:00Z'),Settings:[{key:'SEASON_STATUS',value:'live'}]},
  explicitStatus:'live',status:'live',tabRowCounts:{Settings:2},approximateBytes:100
};
const releaseOneLaterTimestamp={
  ...releaseOne,
  snapshot:{...releaseOne.snapshot,publishedAt:new Date('2026-09-09T12:05:00Z')}
};
const releaseTwo={
  ...releaseOne,
  snapshot:{...releaseOne.snapshot,Settings:[{key:'SEASON_STATUS',value:'live'},{key:'AVAILABLE_THROUGH_EP',value:'2'}]}
};
assert.equal(
  context.__publisher.seasonReleaseHash_(releaseOne),
  context.__publisher.seasonReleaseHash_(releaseOneLaterTimestamp),
  'Published timestamps must not invalidate an otherwise identical preview.'
);

let pendingRelease=releaseOne;
context.buildSeasonSnapshot_=()=>pendingRelease;
context.readFirestoreDocument_=()=>({exists:false,fields:{}});
transactions.length=0;
const preview=context.__publisher.previewSeasonSnapshot(seasonId);
assert.equal(preview.preview,true);
assert.equal(preview.releaseHash,context.__publisher.seasonReleaseHash_(releaseOne));

pendingRelease=releaseTwo;
assert.throws(
  ()=>context.__publisher.publishSeasonSnapshot(seasonId),
  /changed after its last preview/
);
assert.equal(transactions.length,0,'A changed release must be rejected before any Firestore transaction.');

pendingRelease=releaseOneLaterTimestamp;
const published=context.__publisher.publishSeasonSnapshot(seasonId);
assert.equal(published.published,true);
assert.equal(transactions.length,1);
assert.deepEqual(Array.from(transactions[0],write=>write.documentPath),[
  `seasons/${seasonId}`,
  'appConfig/seasonCatalog',
]);
const catalogWrite=transactions[0].find(write=>write.documentPath==='appConfig/seasonCatalog');
const catalogSeasons=catalogWrite.fields.seasons.arrayValue.values;
assert.equal(catalogSeasons.length,1);
assert.equal(catalogSeasons[0].mapValue.fields.id.stringValue,seasonId);
assert.equal(catalogSeasons[0].mapValue.fields.sourceSheetId.stringValue,'');
assert.throws(
  ()=>context.__publisher.publishSeasonSnapshot(seasonId),
  /No approved preview/
);

context.__publisher.previewSeasonSnapshot(seasonId);
context.saveSeasonAdminDraft=()=>{throw new Error('The publish action must not save a stale admin form.');};
assert.equal(context.__publisher.publishSeasonFromAdmin(seasonId).published,true);

context.__publisher.previewSeasonSnapshot(seasonId);
context.commitFirestoreDocuments_=()=>{throw new Error('simulated atomic commit failure');};
assert.throws(
  ()=>context.__publisher.publishSeasonSnapshot(seasonId),
  /simulated atomic commit failure/
);

transactions.length=0;
context.listFirestoreDocuments_=()=>[
  {id:'love-is-blind-test-1',fields:{seasonId:{stringValue:'love-is-blind-test-1'},sourceSheetId:{stringValue:'sheet-1'},status:{stringValue:'completed'},publishedAt:{timestampValue:'2026-01-01T00:00:00.000Z'},Settings:{arrayValue:{values:[{mapValue:{fields:{key:{stringValue:'RELEASE_LABEL'},value:{stringValue:'Winter'}}}}]}}}},
  {id:seasonId,fields:{seasonId:{stringValue:seasonId},sourceSheetId:{stringValue:'sheet-2'},status:{stringValue:'live'},publishedAt:{timestampValue:'2026-09-20T00:00:00.000Z'},Settings:{arrayValue:{values:[{mapValue:{fields:{key:{stringValue:'RELEASE_LABEL'},value:{stringValue:'Fall'}}}}]}}}},
];
context.commitFirestoreDocuments_=(_config,documents)=>transactions.push(documents);
const rebuilt=context.__publisher.rebuildSeasonCatalog(seasonId);
assert.equal(rebuilt.seasonCount,2);
assert.deepEqual(Array.from(rebuilt.seasons,entry=>entry.id),['love-is-blind-test-1',seasonId]);
assert.equal(rebuilt.seasons[1].releaseLabel,'Fall');
assert.deepEqual(Array.from(transactions[0],write=>write.documentPath),['appConfig/seasonCatalog']);

console.log('Season publisher rollover, validation, and atomic-release regressions passed.');
