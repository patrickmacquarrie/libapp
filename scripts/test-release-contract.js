const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html');
const functionsSource=read('functions/index.js');
const publisher=read('scripts/season-publisher/Code.gs');
const admin=read('scripts/season-publisher/Admin.html');
const uk3Fixture=JSON.parse(read('scripts/fixtures/uk3-final-settings.json'));

const failures=[];
const requireContract=(condition,message)=>{if(!condition)failures.push(message);};

function evaluateBrowserResultsReady(seasonStatus,configVersion) {
  const source=html.match(/const resultsReadyDefault = seasonStatus==='completed';[\s\S]*?const resultsReady = \{[\s\S]*?\n  \};/)?.[0];
  assert(source,'Could not isolate the browser RESULTS_READY behavior.');
  const evaluate=vm.runInNewContext(`(seasonStatus,configVersion,boolSetting)=>{${source};return resultsReady;}`);
  return evaluate(seasonStatus,configVersion,(_key,fallback)=>fallback);
}

function evaluateFunctionsResultsReady(seasonStatus,configVersion) {
  const expression=functionsSource.match(/RESULTS_READY:(Object\.fromEntries\(PHASES\.map\([\s\S]*?\)\)),\n    AVAILABLE_THROUGH_EP/)?.[1];
  assert(expression,'Could not isolate the Functions RESULTS_READY behavior.');
  const evaluate=vm.runInNewContext(`(seasonStatus,configVersion,boolSetting,PHASES)=>${expression}`);
  return evaluate(seasonStatus,configVersion,(_key,fallback)=>fallback,['pods','dating','weddings','reunion']);
}

function evaluateBrowserReunionEligibility(value,configVersion) {
  const expression=html.match(/const reunionStatusEligible=([^;]+);/)?.[1];
  assert(expression,'Could not isolate browser reunion eligibility behavior.');
  return vm.runInNewContext(`(r,configVersion,pBool)=>${expression}`)({reunion_status_eligible:value},configVersion,input=>String(input).toUpperCase()==='TRUE');
}

function evaluateFunctionsReunionEligibility(value,configVersion) {
  const expression=functionsSource.match(/reunionStatusEligible:([^,]+),\n      wedding/)?.[1];
  assert(expression,'Could not isolate Functions reunion eligibility behavior.');
  return vm.runInNewContext(`(row,configVersion,publishedBool)=>${expression}`)({reunion_status_eligible:value},configVersion,(input,fallback)=>input==null||input===''?fallback:String(input).toUpperCase()==='TRUE');
}

function rollbackResult() {
  const rollbackSource=publisher.slice(rollbackStart,rollbackEnd);
  const seasonId='love-is-blind-contract-1';
  const seasonPath=`seasons/${seasonId}`;
  const backupPath=`seasonSnapshotBackups/${seasonId}__backup__publish`;
  const documents=new Map([
    [seasonPath,{status:{stringValue:'live'}}],
    [backupPath,{status:{stringValue:'live'},publishedAt:{stringValue:'earlier'}}],
    ['appConfig/public',{defaultSeasonId:{stringValue:'another-season'}}]
  ]);
  const properties=new Map([[`LAST_BACKUP_PATH__${seasonId}`,backupPath]]);
  const context={
    console:{log:()=>{}},
    SEASON_CATALOG_PATH:'appConfig/seasonCatalog',
    publisherConfig_:()=>({projectId:'test-project',seasonId,fallbackDefaultSeasonId:'another-season'}),
    latestBackupPath_:()=>properties.get(`LAST_BACKUP_PATH__${seasonId}`),
    latestAppConfigBackupPath_:()=>'',
    currentDefaultSeasonId_:()=> 'another-season',
    readFirestoreDocument_:(_config,documentPath)=>documents.has(documentPath)?{exists:true,fields:documents.get(documentPath)}:{exists:false,fields:{}},
    backupDocumentPath_:()=>`seasonSnapshotBackups/${seasonId}__rescue__rollback`,
    timestampId_:()=> 'contract',
    seasonCatalogEntry_:(id,fields)=>({id,status:fields.status?.stringValue||'upcoming'}),
    seasonCatalogFieldsWithEntry_:(_catalog,entry)=>({entry}),
    commitFirestoreDocuments_:(_config,writes)=>writes.forEach(write=>documents.set(write.documentPath,write.fields)),
    setLatestBackupPath_:()=>{},clearLatestBackupPath_:()=>{},setLatestAppConfigBackupPath_:()=>{},clearLatestAppConfigBackupPath_:()=>{}
  };
  return vm.runInNewContext(`(${rollbackSource})`,context)(seasonId);
}

async function verifyStandingsRebuildCoalescing(){
  const start=functionsSource.indexOf('async function claimGlobalStandingsRebuild(');
  const end=functionsSource.indexOf('\nexports.rebuildGlobalStandings=',start);
  assert(start>=0&&end>start,'Could not isolate the standings rebuild claim logic.');
  const claim=vm.runInNewContext(`(${functionsSource.slice(start,end)})`,{
    firestoreMillis:value=>value instanceof Date?value.getTime():Number(value)||0,
    STANDINGS_REBUILD_COOLDOWN_MS:20000,
  });
  let marker={requestedAt:new Date(1000)},writes=0;
  const markerRef={path:'pools/global__test/standings/rebuild'};
  const firestore={runTransaction:async operation=>operation({
    get:async()=>({exists:true,data:()=>marker}),
    set:(_ref,value)=>{marker={...marker,...value};writes++;},
  })};
  assert.equal(await claim(markerRef,1000,firestore),true);
  assert.equal(writes,1);
  assert.equal(await claim(markerRef,10000,firestore),false,'A second lock inside 20 seconds must coalesce into the existing rebuild window.');
  assert.equal(writes,1,'A coalesced request must not claim another rebuild.');
  assert.equal(await claim(markerRef,21001,firestore),true,'A later request must be able to claim the next rebuild window.');
  assert.equal(writes,2);
}

async function verifyNotificationChunking(){
  const start=functionsSource.indexOf('async function queueNudgeChunks(');
  const end=functionsSource.indexOf('\nfunction publishedSetting(',start);
  assert(start>=0&&end>start,'Could not isolate notification chunking.');
  const chunkSizes=[];
  const queueNudgeChunks=vm.runInNewContext(`(${functionsSource.slice(start,end)})`,{
    Set,
    getAuth:()=>({getUsers:async identifiers=>{
      chunkSizes.push(identifiers.length);
      return {users:identifiers.map(({uid})=>({uid,email:`${uid}@example.test`}))};
    }}),
    queueNudgeForUser:async()=>true,
  });
  const recipients=Array.from({length:120},(_,index)=>`user-${index}`);
  const sent=await queueNudgeChunks(recipients,uid=>({id:`message-${uid}`,subject:'Subject',text:'Text'}));
  assert.deepEqual(chunkSizes,[50,50,20]);
  assert.equal(sent.size,120);
}

async function verifyContentionRetry(){
  const start=functionsSource.indexOf('async function retryAborted(');
  const end=functionsSource.indexOf('\n\nfunction globalPoolSeasonFromConfig',start);
  assert(start>=0&&end>start,'Could not isolate the contention retry helper.');
  const retryAborted=vm.runInNewContext(`(${functionsSource.slice(start,end)})`,{
    abortedFirestoreWrite:error=>String(error?.code)==='10',
    Promise,setTimeout,Math,
  });
  let attempts=0;
  const result=await retryAborted(async()=>{
    attempts++;
    if(attempts===1)throw Object.assign(new Error('contention'),{code:10});
    return 'ok';
  },3);
  assert.equal(result,'ok');
  assert.equal(attempts,2,'An ABORTED write must retry without making the player repeat the action.');
}

function verifyBoundedStandingsRows(){
  const source=functionsSource.match(/const boundedGlobalStandingsRows=[\s\S]*?\n\}\);/)?.[0];
  assert(source,'Could not isolate the bounded standings-row logic.');
  const bounded=vm.runInNewContext(`${source}\nboundedGlobalStandingsRows`,{GLOBAL_STANDINGS_ROW_LIMIT:500});
  const result=bounded(Array.from({length:503},(_,rank)=>({uid:`player-${rank+1}`,rank:rank+1})));
  assert.equal(result.rows.length,500);
  assert.equal(result.rowCount,503);
  assert.equal(result.truncated,true);
  assert.equal(result.rows.at(-1).rank,500,'The trusted leaderboard document must retain the top 500 rows in rank order.');
}

function verifyGlobalJoinCeiling(){
  const source=functionsSource.match(/const globalJoinHasCapacity=[\s\S]*?\n\};/)?.[0];
  assert(source,'Could not isolate the Global join ceiling.');
  const hasCapacity=vm.runInNewContext(`${source}\nglobalJoinHasCapacity`,{GLOBAL_JOIN_CEILING:8000});
  const full=Array.from({length:8000},(_,index)=>`user-${index}`);
  assert.equal(hasCapacity(full,'new-user'),false,'A new member must be refused at the temporary 8,000-member ceiling.');
  assert.equal(hasCapacity(full,'user-42'),true,'An existing member must still be able to reopen a full Global Pool.');
  assert.equal(hasCapacity(full.slice(1),'new-user'),true);
}

function verifyGlobalSeasonRequiresRuntimeConfig(){
  const source=functionsSource.match(/function globalPoolSeasonFromConfig\(data\)\{[\s\S]*?\n\}/)?.[0];
  assert(source,'Could not isolate the Global Pool runtime-season resolver.');
  class TestHttpsError extends Error{
    constructor(code,message){super(message);this.code=code;}
  }
  const resolve=vm.runInNewContext(`${source}\nglobalPoolSeasonFromConfig`,{
    HttpsError:TestHttpsError,
    safeHeaderText:(value,maxLength=100)=>String(value||'').trim().slice(0,maxLength),
    Number,
  });
  assert.throws(
    ()=>resolve(null),
    error=>error.code==='failed-precondition'&&error.message==='The Global Pool season is not configured'
  );
  assert.throws(
    ()=>resolve({defaultSeasonId:'love-is-blind-uk-3'}),
    error=>error.code==='failed-precondition',
    'A default season alone must not silently become the active Global Pool.'
  );
  assert.equal(resolve({
    globalPoolSeasonId:'love-is-blind-us-11',
    defaultSeason:{id:'love-is-blind-us-11',label:'Love Is Blind US: Season 11',status:'upcoming'},
  }).id,'love-is-blind-us-11');
}

function verifyPublicBetaSeasonBank(){
  const start=html.indexOf("const DEFAULT_SEASON_ID = 'love-is-blind-uk-3';");
  const end=html.indexOf('\nconst seasonOrder =',start);
  assert(start>=0&&end>start,'Could not isolate the season-bank runtime configuration.');
  const config=vm.runInNewContext(`${html.slice(start,end)}\n({DEFAULT_SEASON_ID,SEASON_BANK,applyPublicAppConfig,applyPublishedSeasonSnapshots})`,{Object,Array,String});
  const uk3=config.SEASON_BANK.find(season=>season.id==='love-is-blind-uk-3');
  const us11=config.SEASON_BANK.find(season=>season.id==='love-is-blind-us-11');
  assert.equal(config.DEFAULT_SEASON_ID,'love-is-blind-uk-3','The checked-in default must remain unchanged until the explicit cut-over.');
  assert.equal(uk3?.historical,true);
  assert.equal(uk3?.status,'completed');
  assert(us11,'US Season 11 must exist in the season bank before runtime cut-over.');
  assert.equal(us11.historical,false);
  assert.equal(us11.available,false);
  assert.equal(us11.status,'upcoming');
  assert.equal(us11.locationLabel,'Boston');
  assert.equal(us11.sheetId,'1-Qy-poHMbsO4eEri0NWOpeCmN9qzm76fMabKz0qV39w','US Season 11 must retain the approved source Sheet ID.');
  const selected=config.applyPublicAppConfig({
    defaultSeasonId:'love-is-blind-us-11',
    sourceSheetId:'1-Qy-poHMbsO4eEri0NWOpeCmN9qzm76fMabKz0qV39w',
    status:'upcoming',
  });
  assert.equal(selected,'love-is-blind-us-11');
  assert.equal(us11.available,true,'Published runtime configuration must activate the registered S11 entry.');
  assert.equal(us11.sheetId,'1-Qy-poHMbsO4eEri0NWOpeCmN9qzm76fMabKz0qV39w');
}

const rollbackStart=publisher.indexOf('function rollbackSeasonSnapshot(');
const rollbackEnd=publisher.indexOf('\nfunction rebuildSeasonCatalog(',rollbackStart);
assert(rollbackStart>=0&&rollbackEnd>rollbackStart,'Could not isolate rollbackSeasonSnapshot.');
const rollback=rollbackResult();
verifyBoundedStandingsRows();
verifyGlobalJoinCeiling();
verifyGlobalSeasonRequiresRuntimeConfig();
verifyPublicBetaSeasonBank();
requireContract('appConfigRestoredFrom' in rollback,'Rollback must report whether matching appConfig/public routing metadata was restored.');
requireContract(
  rollback.standingsRepair&&['completed','scheduled'].includes(rollback.standingsRepair.status),
  'Rollback must explicitly schedule or record the required Global standings repair.'
);
requireContract(uk3Fixture.settings.CONFIG_VERSION==null,'The UK3 checkpoint must retain a missing CONFIG_VERSION setting.');
requireContract(uk3Fixture.effectiveConfigVersion===1,'A missing UK3 CONFIG_VERSION must resolve to legacy v1.');
requireContract(Object.keys(uk3Fixture.settings).length===47,'The UK3 checkpoint must contain all 47 captured Settings rows.');
requireContract(['PODS','DATING','WEDDINGS','REUNION'].every(phase=>uk3Fixture.settings[`${phase}_RESULTS_READY`]==='TRUE'),'UK3 must retain its explicit final results-ready settings.');
requireContract(evaluateBrowserResultsReady('live',1).pods===false,'Legacy v1 browser missing RESULTS_READY behavior changed.');
requireContract(evaluateFunctionsResultsReady('live',1).pods===true,'Legacy v1 Functions missing RESULTS_READY behavior changed.');
requireContract(evaluateBrowserReunionEligibility('',1)===uk3Fixture.legacyInterpretation.browserBlankReunionStatusEligible,'UK3 browser Reunion eligibility interpretation changed.');
requireContract(evaluateFunctionsReunionEligibility('',1)===uk3Fixture.legacyInterpretation.functionsBlankReunionStatusEligible,'UK3 Functions Reunion eligibility interpretation changed.');

['live','completed'].forEach(seasonStatus=>{
  const browser=evaluateBrowserResultsReady(seasonStatus,2);
  const functions=evaluateFunctionsResultsReady(seasonStatus,2);
  requireContract(
    JSON.stringify(browser)===JSON.stringify(functions),
    `The browser and Cloud Functions must produce the same missing RESULTS_READY values for a ${seasonStatus} season.`
  );
});
requireContract(
  evaluateBrowserReunionEligibility('',2)===false&&evaluateFunctionsReunionEligibility('',2)===false,
  'Configuration v2 must treat blank reunion_status_eligible as false in the browser and Cloud Functions.'
);

const canonicalPhaseDefaults={
  PODS_START_EP:'1',PODS_END_EP:'6',DATING_START_EP:'5',DATING_END_EP:'9',
  WEDDINGS_START_EP:'9',WEDDINGS_END_EP:'12',REUNION_START_EP:'12',REUNION_END_EP:'13'
};
Object.entries(canonicalPhaseDefaults).forEach(([key,value])=>{
  requireContract(
    String(vm.runInNewContext(`(${admin.match(/const defaults=(\{[\s\S]*?\n    \});/)?.[1]||'{}'})`)[key])===value,
    `Season Admin default ${key} must match the browser/Functions contract value ${value}.`
  );
});
requireContract(
  String(vm.runInNewContext(`(${admin.match(/const defaults=(\{[\s\S]*?\n    \});/)?.[1]||'{}'})`).CONFIG_VERSION)==='1',
  'Season Admin must default missing configurations to legacy v1.'
);

Promise.all([verifyStandingsRebuildCoalescing(),verifyNotificationChunking(),verifyContentionRetry()]).then(()=>{
  if(failures.length){
    console.error('Release contract is not yet satisfied:');
    failures.forEach((failure,index)=>console.error(`${index+1}. ${failure}`));
    process.exitCode=1;
  }else console.log('Rollback and configuration release contract passed.');
}).catch(error=>{console.error(error);process.exitCode=1;});
