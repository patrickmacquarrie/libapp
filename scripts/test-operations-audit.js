const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html');
const functionsSource=read('functions/index.js');
const firestoreRules=read('firestore.rules');
const publisher=read('scripts/season-publisher/Code.gs');
const workflow=read('.github/workflows/deploy-pages.yml');
const runbook=read('SEASON-LAUNCH-RUNBOOK.md');

new Function(functionsSource);
new Function(publisher);

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

assert(workflow.includes('actions/checkout@v6'));
assert(workflow.includes('actions/setup-node@v6'));
assert(workflow.includes('actions/setup-java@v5'));
assert(runbook.includes('rollbackSeasonSnapshot'));
assert(runbook.includes('jsonPayload.message="Client operation failed"'));

console.log('Live-operations audit assertions passed.');
