const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');

const source=fs.readFileSync(path.join(__dirname,'season-publisher','Code.gs'),'utf8');
const scriptProperties=new Map();
let parsedScheduleDate=null;
let parsedScheduleInput=null;
let parsedScheduleTimeZone=null;
const context={
  console:{log:()=>{},warn:()=>{},error:()=>{}},
  Date,
  Utilities:{
    formatDate:()=> '20260909_120000_000',
    newBlob:value=>({getBytes:()=>Buffer.from(value)}),
    DigestAlgorithm:{SHA_256:'SHA_256'},
    Charset:{UTF_8:'UTF_8'},
    computeDigest:(_algorithm,value)=>Array.from(crypto.createHash('sha256').update(value).digest()),
    parseDate:(value,timeZone)=>{
      parsedScheduleInput=value;
      parsedScheduleTimeZone=timeZone;
      return parsedScheduleDate;
    }
  },
  HtmlService:{},SpreadsheetApp:{},LockService:{},UrlFetchApp:{},ScriptApp:{},
  PropertiesService:{getScriptProperties:()=>({
    getProperty:key=>scriptProperties.get(key)||null,
    setProperty:(key,value)=>scriptProperties.set(key,value),
    deleteProperty:key=>scriptProperties.delete(key),
    getProperties:()=>Object.fromEntries(scriptProperties)
  })}
};
vm.createContext(context);
vm.runInContext(`${source}\nthis.__publisher={
  setDefaultSeasonFromAdmin,previewSeasonSnapshot,publishSeasonSnapshot,publishSeasonFromAdmin,
  scheduleSeasonPublishFromAdmin,cancelScheduledSeasonPublishFromAdmin,runScheduledSeasonPublishes,
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

// Scheduled-publish regression coverage.
scriptProperties.clear();
const triggers=[];
const deletedTriggerIds=[];
const sentMail=[];
let triggerCounter=0;
let lockReleases=0;
function newMockTrigger(handler){
  const trigger={
    id:`trigger-${++triggerCounter}`,
    handler,
    atDate:null,
    getUniqueId(){return this.id;},
    getHandlerFunction(){return this.handler;}
  };
  return trigger;
}
context.ScriptApp={
  newTrigger:handler=>{
    const trigger=newMockTrigger(handler);
    return {timeBased:()=>({at:date=>({create:()=>{trigger.atDate=date;triggers.push(trigger);return trigger;}})})};
  },
  getProjectTriggers:()=>triggers.slice(),
  deleteTrigger:trigger=>{
    deletedTriggerIds.push(trigger.getUniqueId());
    const index=triggers.indexOf(trigger);
    if(index>=0)triggers.splice(index,1);
  }
};
context.LockService={getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{lockReleases+=1;}})};
context.Session={
  getScriptTimeZone:()=> 'America/Edmonton',
  getEffectiveUser:()=>({getEmail:()=> 'publisher@example.com'})
};
context.MailApp={sendEmail:(recipient,subject,body)=>sentMail.push({recipient,subject,body})};
context.publisherConfig_=()=>config;

parsedScheduleDate=new Date(Date.now()+10*60*1000);
assert.throws(
  ()=>context.__publisher.scheduleSeasonPublishFromAdmin({seasonId,publishAtLocal:'2026-09-25T01:05'}),
  /Preview this season before scheduling/,
  'Scheduling must require an approved preview.'
);

const previewKey=`LAST_PREVIEW_HASH__${seasonId}`;
const scheduleKey=`SCHEDULED_PUBLISH__${seasonId}`;
scriptProperties.set(previewKey,'approved-hash-1');
const firstSchedule=context.__publisher.scheduleSeasonPublishFromAdmin({seasonId,publishAtLocal:'2026-09-26T01:05'});
assert.equal(parsedScheduleInput,'2026-09-26T01:05');
assert.equal(parsedScheduleTimeZone,'America/Edmonton','datetime-local must be parsed in the script timezone.');
assert.equal(firstSchedule.publishAt,parsedScheduleDate.toISOString());
assert.equal(triggers.length,1);

parsedScheduleDate=new Date(Date.now()+20*60*1000);
const replacementSchedule=context.__publisher.scheduleSeasonPublishFromAdmin({seasonId,publishAtLocal:'2026-09-26T01:15'});
assert.notEqual(replacementSchedule.triggerUid,firstSchedule.triggerUid);
assert.ok(deletedTriggerIds.includes(firstSchedule.triggerUid),'Rescheduling must delete the previous one-off trigger.');
assert.deepEqual(triggers.map(trigger=>trigger.getUniqueId()),[replacementSchedule.triggerUid]);

let scheduledPublishCalls=0;
context.publishSeasonSnapshot=requestedSeasonId=>{
  scheduledPublishCalls+=1;
  return {published:true,seasonId:requestedSeasonId};
};
const dueEntry={...replacementSchedule,publishAt:new Date(Date.now()-60*1000).toISOString()};
scriptProperties.set(scheduleKey,JSON.stringify(dueEntry));
const dueResults=context.__publisher.runScheduledSeasonPublishes({triggerUid:dueEntry.triggerUid});
assert.equal(scheduledPublishCalls,1,'A due schedule must publish exactly once.');
assert.equal(scriptProperties.has(scheduleKey),false,'A successful scheduled publish must clear its entry.');
assert.equal(dueResults[0].status,'published');
assert.match(sentMail.at(-1).subject,/completed/);

scriptProperties.set(previewKey,'approved-hash-2');
parsedScheduleDate=new Date(Date.now()+10*60*1000);
const mismatchSchedule=context.__publisher.scheduleSeasonPublishFromAdmin({seasonId,publishAtLocal:'2026-09-26T01:25'});
scriptProperties.set(previewKey,'different-preview-hash');
scriptProperties.set(scheduleKey,JSON.stringify({...mismatchSchedule,publishAt:new Date(Date.now()-60*1000).toISOString()}));
const mismatchResults=context.__publisher.runScheduledSeasonPublishes({triggerUid:mismatchSchedule.triggerUid});
const failedEntry=JSON.parse(scriptProperties.get(scheduleKey));
assert.equal(scheduledPublishCalls,1,'A preview mismatch must not publish.');
assert.equal(failedEntry.status,'failed');
assert.match(failedEntry.error,/approved preview changed/);
assert.equal(mismatchResults[0].status,'failed');
assert.match(sentMail.at(-1).subject,/failed/);

scriptProperties.set(previewKey,'approved-hash-3');
parsedScheduleDate=new Date(Date.now()+30*60*1000);
const notDueSchedule=context.__publisher.scheduleSeasonPublishFromAdmin({seasonId,publishAtLocal:'2026-09-26T01:35'});
const notDueResults=context.__publisher.runScheduledSeasonPublishes({triggerUid:'some-other-trigger'});
assert.equal(notDueResults[0].status,'not-due');
assert.equal(JSON.parse(scriptProperties.get(scheduleKey)).triggerUid,notDueSchedule.triggerUid);
assert.equal(scheduledPublishCalls,1,'A schedule that is not due must be left alone.');

const earlyOldTriggerUid=notDueSchedule.triggerUid;
const earlyResults=context.__publisher.runScheduledSeasonPublishes({triggerUid:earlyOldTriggerUid});
const earlyEntry=JSON.parse(scriptProperties.get(scheduleKey));
assert.equal(earlyResults[0].status,'rescheduled');
assert.notEqual(earlyEntry.triggerUid,earlyOldTriggerUid,'An early trigger must be replaced for the original publish time.');
assert.equal(scheduledPublishCalls,1,'An early trigger must never publish.');
assert.equal(lockReleases,4,'Every scheduled runner invocation must release its script lock.');

const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'season-publisher','appsscript.json'),'utf8'));
[
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/script.send_mail',
  'https://www.googleapis.com/auth/userinfo.email'
].forEach(scope=>assert.ok(manifest.oauthScopes.includes(scope),`Missing Apps Script scope: ${scope}`));

console.log('Season publisher rollover, validation, atomic-release, and seven scheduled-publish regressions passed.');
