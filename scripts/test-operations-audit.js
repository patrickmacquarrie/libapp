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

assert(publisher.includes('PropertiesService.getScriptProperties()'),'The publisher must read season configuration from Script properties.');
assert(publisher.includes("backupDocumentPath_(config.seasonId, 'publish')"),'Every publish must preserve the previous live snapshot.');
assert(publisher.includes('function rollbackSeasonSnapshot()'),'The season publisher must retain a rollback entry point.');
assert(publisher.includes('function previewSeasonSnapshot()'),'The season publisher must support a no-write preview.');
assert(!publisher.includes("const SEASON_ID ="),'The publisher must not be hardcoded to one season.');
assert(publisher.includes('function doGet()'),'The publisher must serve the season-admin web app.');
assert(publisher.includes('function saveSeasonAdminDraft(payload)'),'The admin must support non-live sheet saves.');
assert(publisher.includes('function previewSeasonFromAdmin(payload)'),'The admin must preserve a read-only preview action.');
assert(publisher.includes('function publishSeasonFromAdmin(payload)'),'The admin must publish through the backup-aware publisher.');
assert(publisher.includes('validateSeasonAdminPayload_'),'The admin must validate submitted season data on the server.');
assert(seasonAdmin.includes('Engagements & Weddings'),'The admin must cover engagement and wedding outcomes.');
assert(seasonAdmin.includes('Retreat outcomes'),'The admin must cover retreat outcomes.');
assert(seasonAdmin.includes('Reunion outcomes'),'The admin must cover Reunion outcomes.');
assert(seasonAdmin.includes('Available through episode'),'The admin must expose episode availability.');
assert(seasonAdmin.includes('Phase starts must remain chronological')===false,'Server validation details should not be duplicated into the UI source.');

const publisherContext={console};
vm.createContext(publisherContext);
vm.runInContext(publisher+'\nthis.__validateSeasonAdminPayload=validateSeasonAdminPayload_;',publisherContext);
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
