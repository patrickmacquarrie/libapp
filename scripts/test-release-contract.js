const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html');
const functionsSource=read('functions/index.js');
const publisher=read('scripts/season-publisher/Code.gs');
const admin=read('scripts/season-publisher/Admin.html');

const failures=[];
const requireContract=(condition,message)=>{if(!condition)failures.push(message);};

const rollbackStart=publisher.indexOf('function rollbackSeasonSnapshot(');
const rollbackEnd=publisher.indexOf('\nfunction publisherConfig_(',rollbackStart);
assert(rollbackStart>=0&&rollbackEnd>rollbackStart,'Could not isolate rollbackSeasonSnapshot.');
const rollbackBody=publisher.slice(rollbackStart,rollbackEnd);

requireContract(
  rollbackBody.includes('APP_CONFIG_PATH'),
  'Rollback must restore the matching appConfig/public routing metadata when the rolled-back season is the default.'
);
requireContract(
  rollbackBody.includes('recomputeGlobalStandings')||rollbackBody.includes('standingsRepair'),
  'Rollback must explicitly schedule or record the required Global standings repair.'
);
requireContract(
  html.includes("const resultsReadyDefault = seasonStatus==='completed';")&&
    functionsSource.includes("boolSetting(`${phase.toUpperCase()}_RESULTS_READY`,seasonStatus==='completed')"),
  'The browser and Cloud Functions must use the same missing RESULTS_READY default.'
);
requireContract(
  html.includes('const reunionStatusEligible=pBool(r.reunion_status_eligible);')&&
    functionsSource.includes("reunionStatusEligible:publishedBool(row.reunion_status_eligible,false)"),
  'The browser and Cloud Functions must both treat blank reunion_status_eligible as false.'
);

const canonicalPhaseDefaults={
  PODS_START_EP:'1',PODS_END_EP:'6',DATING_START_EP:'5',DATING_END_EP:'9',
  WEDDINGS_START_EP:'9',WEDDINGS_END_EP:'12',REUNION_START_EP:'12',REUNION_END_EP:'13'
};
Object.entries(canonicalPhaseDefaults).forEach(([key,value])=>{
  requireContract(
    admin.includes(`${key}:'${value}'`),
    `Season Admin default ${key} must match the browser/Functions contract value ${value}.`
  );
});

if(failures.length){
  console.error('Release contract is not yet satisfied:');
  failures.forEach((failure,index)=>console.error(`${index+1}. ${failure}`));
  process.exitCode=1;
}else{
  console.log('Rollback and configuration release contract passed.');
}
