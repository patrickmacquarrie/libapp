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

async function readPhaseStatusDocuments(){
  const rows=await request(`${apiBase}/documents:runQuery`,{
    method:'POST',
    body:JSON.stringify({
      structuredQuery:{
        from:[{collectionId:'phaseStatus',allDescendants:true}],
      },
    }),
  });
  return rows.map(row=>row.document).filter(Boolean);
}

async function readLegacyDocuments(){
  return (await readPhaseStatusDocuments())
    .filter(document=>Object.prototype.hasOwnProperty.call(document.fields||{},'revealed'));
}

function summary(documents){
  const pools=new Set();
  const phases={};
  const revealedValues={false:0,true:0};
  for(const document of documents){
    const match=document.name.match(/\/pools\/([^/]+)\/phaseStatus\/([^/]+)$/);
    if(!match)throw new Error(`Unexpected phaseStatus path: ${document.name}`);
    pools.add(match[1]);
    phases[match[2]]=(phases[match[2]]||0)+1;
    const revealed=document.fields.revealed?.booleanValue;
    if(typeof revealed!=='boolean'){
      throw new Error(`Unexpected revealed value at ${document.name}`);
    }
    revealedValues[String(revealed)]+=1;
  }
  return {documents:documents.length,pools:pools.size,phases,revealedValues};
}

function writeBackup(documents){
  const destination=path.resolve(backupPath);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,JSON.stringify({
    projectId,
    createdAt:new Date().toISOString(),
    fieldRemoved:'revealed',
    documents,
  },null,2),{mode:0o600});
  return destination;
}

async function removeRevealed(documents){
  const writes=documents.map(document=>({
    update:{name:document.name,fields:{}},
    updateMask:{fieldPaths:['revealed']},
    currentDocument:{updateTime:document.updateTime},
  }));
  for(let index=0;index<writes.length;index+=400){
    await request(`${apiBase}/documents:commit`,{
      method:'POST',
      body:JSON.stringify({writes:writes.slice(index,index+400)}),
    });
  }
}

function fieldsWithoutRevealed(document){
  const fields={...(document.fields||{})};
  delete fields.revealed;
  return fields;
}

function stableJson(value){
  if(Array.isArray(value))return value.map(stableJson);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableJson(value[key])]));
  }
  return value;
}

async function verifyMigration(documents){
  const currentDocuments=await readPhaseStatusDocuments();
  const currentByName=new Map(currentDocuments.map(document=>[document.name,document]));
  for(const original of documents){
    const current=currentByName.get(original.name);
    if(!current)throw new Error(`Verification failed: missing ${original.name}.`);
    const expected=JSON.stringify(stableJson(fieldsWithoutRevealed(original)));
    const actual=JSON.stringify(stableJson(current.fields||{}));
    if(actual!==expected){
      throw new Error(`Verification failed: a non-target field changed at ${original.name}.`);
    }
  }
  const remaining=currentDocuments.filter(document=>
    Object.prototype.hasOwnProperty.call(document.fields||{},'revealed')
  );
  if(remaining.length)throw new Error(`Verification failed: ${remaining.length} documents still contain revealed.`);
}

async function main(){
  const documents=await readLegacyDocuments();
  const before=summary(documents);
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',projectId,before},null,2));

  if(!apply){
    if(backupPath)console.log(`Backup written to ${writeBackup(documents)}`);
    return;
  }

  if(documents.length!==expectedCount){
    throw new Error(`Refusing migration: expected ${expectedCount} documents, found ${documents.length}.`);
  }
  console.log(`Backup written to ${writeBackup(documents)}`);
  await removeRevealed(documents);
  await verifyMigration(documents);
  console.log(JSON.stringify({applied:documents.length,remaining:0},null,2));
}

main().catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});
