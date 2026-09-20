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
    publisherConfig_:()=>({projectId:'test-project',seasonId,fallbackDefaultSeasonId:'another-season'}),
    latestBackupPath_:()=>properties.get(`LAST_BACKUP_PATH__${seasonId}`),
    latestAppConfigBackupPath_:()=>'',
    currentDefaultSeasonId_:()=> 'another-season',
    readFirestoreDocument_:(_config,documentPath)=>documents.has(documentPath)?{exists:true,fields:documents.get(documentPath)}:{exists:false,fields:{}},
    backupDocumentPath_:()=>`seasonSnapshotBackups/${seasonId}__rescue__rollback`,
    timestampId_:()=> 'contract',
    commitFirestoreDocuments_:(_config,writes)=>writes.forEach(write=>documents.set(write.documentPath,write.fields)),
    setLatestBackupPath_:()=>{},clearLatestBackupPath_:()=>{},setLatestAppConfigBackupPath_:()=>{},clearLatestAppConfigBackupPath_:()=>{}
  };
  return vm.runInNewContext(`(${rollbackSource})`,context)(seasonId);
}

const rollbackStart=publisher.indexOf('function rollbackSeasonSnapshot(');
const rollbackEnd=publisher.indexOf('\nfunction publisherConfig_(',rollbackStart);
assert(rollbackStart>=0&&rollbackEnd>rollbackStart,'Could not isolate rollbackSeasonSnapshot.');
const rollback=rollbackResult();
requireContract('appConfigRestoredFrom' in rollback,'Rollback must report whether matching appConfig/public routing metadata was restored.');
requireContract(
  rollback.standingsRepair&&['completed','scheduled'].includes(rollback.standingsRepair.status),
  'Rollback must explicitly schedule or record the required Global standings repair.'
);
requireContract(uk3Fixture.settings.CONFIG_VERSION==null,'The UK3 checkpoint must retain a missing CONFIG_VERSION setting.');
requireContract(uk3Fixture.effectiveConfigVersion===1,'A missing UK3 CONFIG_VERSION must resolve to legacy v1.');
requireContract(Object.keys(uk3Fixture.settings).length===47,'The UK3 checkpoint must contain all 47 captured Settings rows.');
requireContract(evaluateBrowserResultsReady('live',1).pods===uk3Fixture.legacyInterpretation.browserMissingResultsReadyForLiveSeason,'UK3 browser RESULTS_READY interpretation changed.');
requireContract(evaluateFunctionsResultsReady('live',1).pods===uk3Fixture.legacyInterpretation.functionsMissingResultsReadyForLiveSeason,'UK3 Functions RESULTS_READY interpretation changed.');
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

if(failures.length){
  console.error('Release contract is not yet satisfied:');
  failures.forEach((failure,index)=>console.error(`${index+1}. ${failure}`));
  process.exitCode=1;
}else{
  console.log('Rollback and configuration release contract passed.');
}
