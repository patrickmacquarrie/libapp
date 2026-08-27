const fs=require('node:fs');
const path=require('node:path');

const argv=process.argv.slice(2);
const hasFlag=flag=>argv.includes(flag);
const valueFor=flag=>{
  const index=argv.indexOf(flag);
  return index>=0?argv[index+1]:undefined;
};

const projectId=valueFor('--project')||'lib-oauth';
const accessToken=process.env.FIREBASE_ACCESS_TOKEN;
const apply=hasFlag('--apply');
const backupPath=valueFor('--backup');
const expectedRaw=valueFor('--expected-count');
const expectedCount=expectedRaw===undefined?null:Number(expectedRaw);
const database=`projects/${projectId}/databases/(default)`;
const apiBase=`https://firestore.googleapis.com/v1/${database}`;

if(projectId!=='lib-oauth')throw new Error(`Refusing unexpected project: ${projectId}`);
if(!accessToken)throw new Error('Set FIREBASE_ACCESS_TOKEN to a short-lived Google OAuth access token.');
if(apply&&!backupPath)throw new Error('--apply requires --backup PATH.');
if(apply&&(!Number.isInteger(expectedCount)||expectedCount<0)){
  throw new Error('--apply requires --expected-count N.');
}

async function request(url,options={}){
  const response=await fetch(url,{
    ...options,
    headers:{
      Authorization:`Bearer ${accessToken}`,
      'Content-Type':'application/json',
      ...(options.headers||{}),
    },
  });
  const text=await response.text();
  if(!response.ok)throw new Error(`${response.status} ${response.statusText}: ${text}`);
  return text?JSON.parse(text):null;
}

async function readDocument(name){
  const response=await fetch(`https://firestore.googleapis.com/v1/${name}`,{
    headers:{Authorization:`Bearer ${accessToken}`},
  });
  if(response.status===404)return null;
  const text=await response.text();
  if(!response.ok)throw new Error(`${response.status} ${response.statusText}: ${text}`);
  return text?JSON.parse(text):null;
}

async function readGlobalPools(){
  const rows=await request(`${apiBase}/documents:runQuery`,{
    method:'POST',
    body:JSON.stringify({
      structuredQuery:{
        from:[{collectionId:'pools'}],
        where:{fieldFilter:{field:{fieldPath:'global'},op:'EQUAL',value:{booleanValue:true}}},
      },
    }),
  });
  return rows.map(row=>row.document).filter(Boolean);
}

const integerField=(document,field)=>{
  const raw=document?.fields?.[field]?.integerValue;
  const value=raw===undefined?NaN:Number(raw);
  return Number.isInteger(value)&&value>=0?value:null;
};

async function readMemberLedgers(){
  const pools=await readGlobalPools();
  const entries=[];
  for(const pool of pools){
    const poolId=pool.name.split('/').pop();
    const members=(pool.fields?.members?.arrayValue?.values||[])
      .map(value=>String(value.stringValue||''))
      .filter(Boolean);
    for(const uid of [...new Set(members)]){
      const name=`${pool.name}/trustedPlayers/${uid}`;
      const document=await readDocument(name);
      entries.push({poolId,uid,name,document});
    }
  }
  return entries;
}

const needsBackfill=entry=>!entry.document||
  integerField(entry.document,'joinedAtEp')===null||
  integerField(entry.document,'watchedThrough')===null;

function summary(entries){
  return {
    globalPools:new Set(entries.map(entry=>entry.poolId)).size,
    members:entries.length,
    documentsToCreate:entries.filter(entry=>!entry.document).length,
    documentsToMerge:entries.filter(entry=>entry.document&&needsBackfill(entry)).length,
    alreadyMigrated:entries.filter(entry=>!needsBackfill(entry)).length,
    backfill:{joinedAtEp:0,watchedThrough:0},
  };
}

function writeBackup(entries){
  const destination=path.resolve(backupPath);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,JSON.stringify({
    projectId,
    createdAt:new Date().toISOString(),
    policy:'Existing controlled-test members are early joiners.',
    backfill:{joinedAtEp:0,watchedThrough:0},
    entries:entries.map(({poolId,uid,name,document})=>({poolId,uid,name,document})),
  },null,2),{mode:0o600});
  return destination;
}

function migrationWrite(entry){
  const fields={};
  const fieldPaths=[];
  if(integerField(entry.document,'joinedAtEp')===null){
    fields.joinedAtEp={integerValue:'0'};
    fieldPaths.push('joinedAtEp');
  }
  if(integerField(entry.document,'watchedThrough')===null){
    fields.watchedThrough={integerValue:'0'};
    fieldPaths.push('watchedThrough');
  }
  if(!entry.document){
    fields.uid={stringValue:entry.uid};
    fieldPaths.push('uid');
  }
  if(!fieldPaths.length)return null;
  return {
    update:{name:entry.name,fields},
    updateMask:{fieldPaths},
    currentDocument:entry.document?{updateTime:entry.document.updateTime}:{exists:false},
  };
}

async function applyMigration(entries){
  const writes=entries.map(migrationWrite).filter(Boolean);
  for(let index=0;index<writes.length;index+=400){
    await request(`${apiBase}/documents:commit`,{
      method:'POST',
      body:JSON.stringify({writes:writes.slice(index,index+400)}),
    });
  }
  return writes.length;
}

function stableJson(value){
  if(Array.isArray(value))return value.map(stableJson);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableJson(value[key])]));
  }
  return value;
}

const withoutLedgerFields=fields=>{
  const copy={...(fields||{})};
  delete copy.joinedAtEp;
  delete copy.watchedThrough;
  return copy;
};

async function verifyMigration(entries){
  for(const entry of entries){
    const current=await readDocument(entry.name);
    if(!current)throw new Error(`Verification failed: missing ${entry.name}.`);
    const expectedJoined=integerField(entry.document,'joinedAtEp')??0;
    const expectedWatched=integerField(entry.document,'watchedThrough')??0;
    if(integerField(current,'joinedAtEp')!==expectedJoined||integerField(current,'watchedThrough')!==expectedWatched){
      throw new Error(`Verification failed: ledger values changed unexpectedly at ${entry.name}.`);
    }
    if(entry.document){
      const before=JSON.stringify(stableJson(withoutLedgerFields(entry.document.fields)));
      const after=JSON.stringify(stableJson(withoutLedgerFields(current.fields)));
      if(before!==after)throw new Error(`Verification failed: a non-ledger field changed at ${entry.name}.`);
    }else{
      const expected={uid:{stringValue:entry.uid}};
      const actual=withoutLedgerFields(current.fields);
      if(JSON.stringify(stableJson(expected))!==JSON.stringify(stableJson(actual))){
        throw new Error(`Verification failed: unexpected fields were created at ${entry.name}.`);
      }
    }
  }
}

async function main(){
  const entries=await readMemberLedgers();
  const before=summary(entries);
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',projectId,before},null,2));

  if(!apply){
    if(backupPath)console.log(`Backup written to ${writeBackup(entries)}`);
    return;
  }
  if(entries.length!==expectedCount){
    throw new Error(`Refusing migration: expected ${expectedCount} Global Pool members, found ${entries.length}.`);
  }
  console.log(`Backup written to ${writeBackup(entries)}`);
  const applied=await applyMigration(entries);
  await verifyMigration(entries);
  console.log(JSON.stringify({applied,membersVerified:entries.length,backfill:{joinedAtEp:0,watchedThrough:0}},null,2));
  console.log('Recompute Global standings after the backend deploy; the next trusted lock or completion also performs this recompute.');
}

main().catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});
