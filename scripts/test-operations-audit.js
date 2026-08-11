const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html');
const functionsSource=read('functions/index.js');
const firestoreRules=read('firestore.rules');
const publisher=read('scripts/season-publisher/Code.gs');
const seasonAdmin=read('scripts/season-publisher/Admin.html');
const workflow=read('.github/workflows/deploy-pages.yml');
const runbook=read('SEASON-LAUNCH-RUNBOOK.md');

new Function(functionsSource);
new Function(publisher);
const seasonAdminScript=seasonAdmin.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(seasonAdminScript,'Season admin must include browser logic.');
new Function(seasonAdminScript);

assert(html.includes("doc(db,'clientErrors',user.uid,'categories',category)"),'Client failures must use authenticated Firestore diagnostics.');
assert(html.includes('occurrenceCount:increment(1)'),'Client failure counts must remain bounded to one document per user and category.');
assert(html.includes('lastAt:serverTimestamp()'),'Client failure throttling must use the trusted server timestamp.');
assert(!html.includes("httpsCallable(functions,'reportClientError')"),'Client failures must not use the organization-blocked public callable.');
assert(firestoreRules.includes('match /clientErrors/{userId}/categories/{category}'),'Firestore rules must protect client diagnostics.');
assert(firestoreRules.includes('allow read, delete: if false'),'Browser clients must not read or delete diagnostics.');
assert(firestoreRules.includes("duration.value(1, 'm')"),'Repeated diagnostics must be throttled in Firestore rules.');
['save_failed','season_load_failed','pool_open_failed','pool_create_failed','invite_send_failed','invite_accept_failed','mirror_sync_failed'].forEach(category=>{
  assert(firestoreRules.includes(`'${category}'`),`${category} must be accepted by the diagnostic rules.`);
  assert(html.includes(`reportTtwError('${category}'`),`${category} must be reported by the app.`);
});
assert(!html.includes('data?.message'),'Browser error messages must not be copied into production diagnostics.');
assert(!html.includes('data?.stack'),'Browser stack traces must not be copied into production diagnostics.');
assert(html.includes('listPublishedSeasonSnapshots'),'The app must discover newly published roadmap seasons from Firestore.');
assert(html.includes('applyPublishedSeasonSnapshots'),'Published season snapshots must activate their matching season-library entries.');
assert(html.includes("collection(db,'seasons')"),'Published season discovery must use the protected seasons collection.');
assert(html.includes("raw.length===0&&PUBLISHED_TAB_HEADERS[wanted]"),'Empty live-result tabs must remain usable from a published snapshot.');

assert(publisher.includes('PropertiesService.getScriptProperties()'),'The publisher must read season configuration from Script properties.');
assert(publisher.includes("backupDocumentPath_(config.seasonId, 'publish')"),'Every publish must preserve the previous live snapshot.');
assert(publisher.includes('function rollbackSeasonSnapshot('),'The season publisher must retain a rollback entry point.');
assert(publisher.includes('function previewSeasonSnapshot('),'The season publisher must support a no-write preview.');
assert(!publisher.includes("const SEASON_ID ="),'The publisher must not be hardcoded to one season.');
assert(publisher.includes('function doGet()'),'The publisher must serve the season-admin web app.');
assert(publisher.includes('function saveSeasonAdminDraft(payload)'),'The admin must support non-live sheet saves.');
assert(publisher.includes('function previewSeasonFromAdmin(payload)'),'The admin must preserve a read-only preview action.');
assert(publisher.includes('function publishSeasonFromAdmin(payload)'),'The admin must publish through the backup-aware publisher.');
assert(publisher.includes('validateSeasonAdminPayload_'),'The admin must validate submitted season data on the server.');
assert(publisher.includes('SEASONS_JSON'),'The publisher must support an explicit season allow-list.');
assert(publisher.includes('publisherConfig_(requestedSeasonId)'),'Every publisher action must resolve the selected registered season.');
assert(publisher.includes('function connectSeasonFromAdmin(payload)'),'The admin must be able to connect another season sheet.');
assert(publisher.includes("setProperty('SEASONS_JSON'"),'Connected season sheets must persist in the private allow-list.');
assert(seasonAdmin.includes('Engagements & Weddings'),'The admin must cover engagement and wedding outcomes.');
assert(seasonAdmin.includes('Retreat outcomes'),'The admin must cover retreat outcomes.');
assert(seasonAdmin.includes('Reunion outcomes'),'The admin must cover Reunion outcomes.');
assert(seasonAdmin.includes('Available through episode'),'The admin must expose episode availability.');
assert(seasonAdmin.includes('id="seasonSelect"'),'The admin must expose a season switcher.');
assert(seasonAdmin.includes('id="connectSeasonButton"'),'The admin must expose a connect-season action.');
assert(seasonAdmin.includes('connectSeasonFromAdmin(request)'),'The connect-season form must use server-side sheet validation.');
assert(seasonAdmin.includes('<svg viewBox="0 0 1024 1024">'),'The season admin must use the Through the Wall app icon.');
assert(seasonAdmin.includes("active='release'"),'Preview failures must open the visible result panel.');
assert(seasonAdmin.includes('Nothing was published.'),'Validation failures must clearly state that live data was not changed.');
assert(seasonAdmin.includes('Phase starts must remain chronological')===false,'Server validation details should not be duplicated into the UI source.');

const publisherContext={console};
vm.createContext(publisherContext);
vm.runInContext(publisher+'\nthis.__validateSeasonAdminPayload=validateSeasonAdminPayload_;this.__publisherSeasonRegistry=publisherSeasonRegistryFromProperties_;this.__publisherSpreadsheetId=publisherSpreadsheetId_;this.__upsertPublisherSeason=upsertPublisherSeason_;',publisherContext);
const seasons=publisherContext.__publisherSeasonRegistry({
  SEASON_ID:'love-is-blind-uk-3',
  SPREADSHEET_ID:'uk3sheet',
  SEASONS_JSON:JSON.stringify([{seasonId:'love-is-blind-br-1',spreadsheetId:'br1sheet',label:'Brazil Season 1'}])
});
assert.equal(seasons.length,2);
assert.equal(seasons[0].seasonId,'love-is-blind-uk-3');
assert.equal(seasons[1].label,'Brazil Season 1');
assert.throws(()=>publisherContext.__publisherSeasonRegistry({SEASONS_JSON:'not json'}),/not valid JSON/i);
assert.throws(()=>publisherContext.__publisherSeasonRegistry({SEASONS_JSON:JSON.stringify([
  {seasonId:'duplicate',spreadsheetId:'one'},
  {seasonId:'duplicate',spreadsheetId:'two'}
])}),/more than once/i);
assert.equal(publisherContext.__publisherSpreadsheetId('https://docs.google.com/spreadsheets/d/1234567890abcdefghij/edit#gid=0'),'1234567890abcdefghij');
assert.equal(publisherContext.__publisherSpreadsheetId('https://docs.google.com/spreadsheets/u/0/d/abcdefghij1234567890/edit'),'abcdefghij1234567890');
assert.throws(()=>publisherContext.__publisherSpreadsheetId('not-a-sheet'),/complete Google Sheet link/i);
const connected=publisherContext.__upsertPublisherSeason(seasons,{seasonId:'love-is-blind-se-1',spreadsheetId:'se1sheet',label:'Sweden Season 1'});
assert.equal(connected.length,3);
assert.equal(connected[2].label,'Sweden Season 1');
assert.throws(()=>publisherContext.__upsertPublisherSeason(connected,{seasonId:'love-is-blind-se-1',spreadsheetId:'other',label:'Wrong'}),/different spreadsheet/i);
assert.throws(()=>publisherContext.__upsertPublisherSeason(connected,{seasonId:'another-season',spreadsheetId:'se1sheet',label:'Wrong'}),/already connected/i);
const mockScriptProperties={
  PROJECT_ID:'lib-oauth',
  SEASON_ID:'love-is-blind-uk-3',
  SPREADSHEET_ID:'1234567890uk3sheetidabc'
};
publisherContext.PropertiesService={getScriptProperties:()=>({
  getProperties:()=>({...mockScriptProperties}),
  setProperty:(key,value)=>{mockScriptProperties[key]=value;}
})};
publisherContext.SpreadsheetApp={openById:()=>({getSheetByName:tabName=>({tabName})})};
publisherContext.LockService={getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})};
publisherContext.getSeasonAdminData=seasonId=>({seasonId});
const connectedModel=publisherContext.connectSeasonFromAdmin({
  seasonId:'love-is-blind-se-1',
  label:'Sweden Season 1',
  spreadsheetUrl:'https://docs.google.com/spreadsheets/d/1234567890swedensheetid/edit'
});
assert.equal(connectedModel.seasonId,'love-is-blind-se-1');
assert.equal(JSON.parse(mockScriptProperties.SEASONS_JSON).at(-1).label,'Sweden Season 1');
const baseAdminSettings={
  SEASON_STATUS:'comingSoon',RELEASE_LABEL:'First episodes soon',AVAILABLE_THROUGH_EP:'0',BOUNDARIES_LIVE:'TRUE',
  PODS_START_EP:'1',PODS_END_EP:'5',DATING_START_EP:'5',DATING_END_EP:'7',RETREAT_START_EP:'5',RETREAT_END_EP:'7',
  WEDDINGS_START_EP:'7',WEDDINGS_END_EP:'11',REUNION_START_EP:'11',REUNION_END_EP:'12',
  PODS_BOUNDARY_FINAL:'FALSE',DATING_BOUNDARY_FINAL:'FALSE',WEDDINGS_BOUNDARY_FINAL:'FALSE',REUNION_BOUNDARY_FINAL:'FALSE',
  PODS_RESULTS_READY:'FALSE',DATING_RESULTS_READY:'FALSE',WEDDINGS_RESULTS_READY:'FALSE',REUNION_RESULTS_READY:'FALSE',
  PODS_BUDGET:'200',PODS_CAP:'60',DATING_BUDGET:'150',DATING_CAP:'40',WEDDINGS_BUDGET:'150',WEDDINGS_CAP:'80',REUNION_BUDGET:'100',REUNION_CAP:'40',
};
const baseAdminPayload={
  settings:baseAdminSettings,
  cast:[{gender:'M',name:'Alex'},{gender:'F',name:'Blair'}],
  couples:[{id:'alex-blair',him:'Alex',her:'Blair',engagedEp:'3',wedding:'',whoSaysNo:'',breakupEp:'',settledEp:'',togetherNow:'',lockEp:'11',podsEligible:'TRUE',datingEligible:'TRUE',reunionStatusEligible:'TRUE'}],
  datingResults:[{market:'sex',coupleId:'alex-blair',episode:'6',person:'',confirmed:'TRUE'}],
  reunionResults:[{market:'still',target:'alex-blair',value:'TRUE',notes:''}],
  retroEvents:[],
};
const validatedAdmin=publisherContext.__validateSeasonAdminPayload(baseAdminPayload);
assert.equal(validatedAdmin.cast.length,2);
assert.equal(validatedAdmin.couples[0].id,'alex-blair');
assert.throws(()=>publisherContext.__validateSeasonAdminPayload({...baseAdminPayload,cast:[...baseAdminPayload.cast,{gender:'M',name:'alex'}]}),/duplicated/i);
assert.throws(()=>publisherContext.__validateSeasonAdminPayload({...baseAdminPayload,datingResults:[{market:'sex',coupleId:'alex-blair',episode:'9',confirmed:'TRUE'}]}),/Episodes 5 and 7/i);
assert.throws(()=>publisherContext.__validateSeasonAdminPayload({...baseAdminPayload,settings:{...baseAdminSettings,SEASON_STATUS:'live',AVAILABLE_THROUGH_EP:'0'}}),/live season/i);

assert(workflow.includes('actions/checkout@v6'));
assert(workflow.includes('actions/setup-node@v6'));
assert(workflow.includes('actions/setup-java@v5'));
assert(runbook.includes('rollbackSeasonSnapshot'));
assert(runbook.includes('jsonPayload.message="Client operation failed"'));

console.log('Live-operations audit assertions passed.');
