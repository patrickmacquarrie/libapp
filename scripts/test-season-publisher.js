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
    DigestAlgorithm:{SHA_256:'SHA_256'},
    Charset:{UTF_8:'UTF_8'},
    computeDigest:(_algorithm,value)=>Array.from(crypto.createHash('sha256').update(value).digest())
  },
  HtmlService:{},
  SpreadsheetApp:{},
  LockService:{},
  PropertiesService:{getScriptProperties:()=>({
    getProperty:key=>scriptProperties.get(key)||null,
    setProperty:(key,value)=>scriptProperties.set(key,value),
    deleteProperty:key=>scriptProperties.delete(key)
  })},
  UrlFetchApp:{},
  ScriptApp:{}
};
vm.createContext(context);
vm.runInContext(`${source}\nthis.__publisher={setDefaultSeasonFromAdmin,previewSeasonSnapshot,publishSeasonSnapshot,backupDocumentPath_,timestampId_,seasonReleaseHash_,assertUniqueSettings_};`,context);

const writes=[];
context.publisherConfig_=()=>({
  projectId:'test-project',
  seasonId:'love-is-blind-test-2',
  spreadsheetId:'sheet-2',
  seasons:[{seasonId:'love-is-blind-test-2',label:'Test Season 2'}]
});
context.readFirestoreDocument_=(_config,documentPath)=>{
  if(documentPath==='seasons/love-is-blind-test-2'){
    return {exists:true,fields:{status:{stringValue:'live'}}};
  }
  if(documentPath==='appConfig/public'){
    return {exists:true,fields:{defaultSeasonId:{stringValue:'love-is-blind-test-1'}}};
  }
  throw new Error(`Unexpected read: ${documentPath}`);
};
context.SpreadsheetApp={openById:()=>({})};
context.readAdminTable_=()=>[{key:'RELEASE_LABEL',value:'Fall test'}];
context.publisherSeasonMetadata_=()=>({id:'love-is-blind-test-2',label:'Test Season 2'});
context.writeFirestoreDocument_=(_config,documentPath,fields)=>writes.push({documentPath,fields});
context.mapFields_=value=>value;
context.getSeasonAdminData=()=>({seasonId:'love-is-blind-test-2'});

const result=context.__publisher.setDefaultSeasonFromAdmin('love-is-blind-test-2');
assert.equal(result.changed,true);
assert.equal(result.previousConfigBackupPath,'appConfigBackups/default__20260909_120000_000');
assert.deepEqual(writes.map(write=>write.documentPath),[
  'appConfigBackups/default__20260909_120000_000',
  'appConfig/public'
]);
assert.equal(writes[1].fields.defaultSeasonId,'love-is-blind-test-2');
assert.equal(context.__publisher.backupDocumentPath_('love-is-blind-test-2','publish'),'seasonSnapshotBackups/love-is-blind-test-2__20260909_120000_000__publish');
assert.equal(context.__publisher.timestampId_(),'20260909_120000_000');

assert.throws(
  ()=>context.__publisher.assertUniqueSettings_([{key:'PODS_CAP'},{key:'PODS_CAP'}]),
  /more than once/
);

const releaseOne={
  fields:{status:{stringValue:'live'}},
  snapshot:{seasonId:'love-is-blind-test-2',status:'live',publishedAt:new Date('2026-09-09T12:00:00Z'),Settings:[{key:'SEASON_STATUS',value:'live'}]},
  explicitStatus:'live',
  status:'live',
  tabRowCounts:{Settings:2},
  approximateBytes:100
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
context.currentDefaultSeasonId_=()=> 'love-is-blind-test-1';
context.readFirestoreDocument_=()=>({exists:false,fields:{}});
writes.length=0;
const preview=context.__publisher.previewSeasonSnapshot('love-is-blind-test-2');
assert.equal(preview.preview,true);
assert.equal(preview.releaseHash,context.__publisher.seasonReleaseHash_(releaseOne));

pendingRelease=releaseTwo;
assert.throws(
  ()=>context.__publisher.publishSeasonSnapshot('love-is-blind-test-2'),
  /changed after its last preview/
);
assert.equal(writes.length,0,'A changed release must be rejected before any Firestore write.');

pendingRelease=releaseOneLaterTimestamp;
const published=context.__publisher.publishSeasonSnapshot('love-is-blind-test-2');
assert.equal(published.published,true);
assert.equal(writes.length,1);
assert.throws(
  ()=>context.__publisher.publishSeasonSnapshot('love-is-blind-test-2'),
  /No approved preview/
);

console.log('Season publisher rollover regression passed.');
