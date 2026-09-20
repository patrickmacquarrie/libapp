const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const checkpointPath=path.resolve(process.env.UK3_CHECKPOINT_PATH||'');
const firestoreHost=process.env.FIRESTORE_EMULATOR_HOST||'';
const projectId=process.env.GCLOUD_PROJECT||'demo-libapp';
const sourceSeasonId='love-is-blind-uk-3';
const cloneSeasonId='rehearsal__love-is-blind-uk-3';

assert(process.env.UK3_CHECKPOINT_PATH,'Set UK3_CHECKPOINT_PATH to the private Firestore checkpoint.');
assert(fs.existsSync(checkpointPath),`Checkpoint not found: ${checkpointPath}`);
assert(/^(127\.0\.0\.1|localhost):\d+$/.test(firestoreHost),'This rehearsal may run only against a local Firestore emulator.');

const checkpoint=JSON.parse(fs.readFileSync(checkpointPath,'utf8'));
assert.equal(checkpoint.metadata?.seasonId,sourceSeasonId,'The checkpoint is not the UK3 export.');
const databaseName=`projects/${projectId}/databases/(default)`;
const databaseUrl=`http://${firestoreHost}/v1/${databaseName}/documents`;

const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const canonical=value=>{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
};
const fieldsHash=fields=>hash(JSON.stringify(canonical(fields)));
const documentId=document=>document.name.split('/').pop();
const encodedPath=documentPath=>documentPath.split('/').map(encodeURIComponent).join('/');

function stringValues(value,result=[]){
  if(Array.isArray(value))value.forEach(item=>stringValues(item,result));
  else if(value&&typeof value==='object'){
    if(typeof value.stringValue==='string')result.push(value.stringValue);
    Object.values(value).forEach(item=>stringValues(item,result));
  }
  return result;
}

const poolIdMap=new Map();
let friendSequence=0;
for(const pool of checkpoint.pools||[]){
  const sourcePoolId=documentId(pool.document);
  poolIdMap.set(sourcePoolId,sourcePoolId===`global__${sourceSeasonId}`
    ? `rehearsal__global__${sourceSeasonId}`
    : `rehearsal__friend_${++friendSequence}`);
}

const candidateUserIds=new Set();
for(const pool of checkpoint.pools||[]){
  const fields=pool.document.fields||{};
  const members=fields.members?.arrayValue?.values||[];
  members.forEach(value=>{if(value.stringValue)candidateUserIds.add(value.stringValue);});
  ['players','trustedPlayers'].forEach(collectionId=>(pool.collections?.[collectionId]||[]).forEach(document=>candidateUserIds.add(documentId(document))));
  (pool.collections?.phasePicks||[]).forEach(document=>{
    const match=documentId(document).match(/^[^_]+__(.+)$/);
    if(match)candidateUserIds.add(match[1]);
  });
}
const userIdMap=new Map([...candidateUserIds].map(uid=>[uid,`rehearsal_user_${hash(uid).slice(0,12)}`]));

function transformString(value){
  if(value===sourceSeasonId)return cloneSeasonId;
  if(poolIdMap.has(value))return poolIdMap.get(value);
  if(userIdMap.has(value))return userIdMap.get(value);
  for(const [sourcePoolId,clonePoolId] of poolIdMap){
    if(value.includes(`/pools/${sourcePoolId}/`))value=value.replace(`/pools/${sourcePoolId}/`,`/pools/${clonePoolId}/`);
  }
  if(value.includes(`/seasons/${sourceSeasonId}`))value=value.replace(`/seasons/${sourceSeasonId}`,`/seasons/${cloneSeasonId}`);
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return `rehearsal+${hash(value).slice(0,12)}@example.invalid`;
  return value;
}

function transformValue(value){
  if(Array.isArray(value))return value.map(transformValue);
  if(!value||typeof value!=='object')return value;
  if(typeof value.stringValue==='string')return {...value,stringValue:transformString(value.stringValue)};
  if(typeof value.referenceValue==='string')return {...value,referenceValue:transformString(value.referenceValue)};
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,transformValue(item)]));
}

function transformDocumentId(collectionId,sourceId){
  if(['players','trustedPlayers'].includes(collectionId)&&userIdMap.has(sourceId))return userIdMap.get(sourceId);
  if(collectionId==='phasePicks'){
    const match=sourceId.match(/^([^_]+)__(.+)$/);
    if(match&&userIdMap.has(match[2]))return `${match[1]}__${userIdMap.get(match[2])}`;
  }
  return sourceId;
}

async function request(url,options={}){
  const response=await fetch(url,{
    ...options,
    headers:{Authorization:'Bearer owner','Content-Type':'application/json',...(options.headers||{})},
  });
  const text=await response.text();
  const body=text?JSON.parse(text):{};
  assert(response.ok,`${options.method||'GET'} ${url} failed (${response.status}): ${body.error?.message||response.statusText}`);
  return body;
}

async function writeDocument(documentPath,fields){
  await request(`${databaseUrl}/${encodedPath(documentPath)}`,{method:'PATCH',body:JSON.stringify({fields})});
}

async function readDocument(documentPath){
  return request(`${databaseUrl}/${encodedPath(documentPath)}`);
}

async function commit(entries){
  await request(`http://${firestoreHost}/v1/${databaseName}/documents:commit`,{
    method:'POST',
    body:JSON.stringify({writes:entries.map(entry=>({update:{name:`${databaseName}/documents/${entry.path}`,fields:entry.fields}}))}),
  });
}

async function main(){
  const cloneEntries=[{path:`seasons/${cloneSeasonId}`,fields:transformValue(checkpoint.season.fields||{})}];
  for(const pool of checkpoint.pools||[]){
    const sourcePoolId=documentId(pool.document);
    const clonePoolId=poolIdMap.get(sourcePoolId);
    cloneEntries.push({path:`pools/${clonePoolId}`,fields:transformValue(pool.document.fields||{})});
    for(const [collectionId,documents] of Object.entries(pool.collections||{})){
      for(const document of documents){
        const cloneDocumentId=transformDocumentId(collectionId,documentId(document));
        cloneEntries.push({path:`pools/${clonePoolId}/${collectionId}/${cloneDocumentId}`,fields:transformValue(document.fields||{})});
      }
    }
  }

  for(const entry of cloneEntries)await writeDocument(entry.path,entry.fields);
  for(const entry of cloneEntries){
    const stored=await readDocument(entry.path);
    assert.equal(fieldsHash(stored.fields||{}),fieldsHash(entry.fields),`Clone verification failed for ${entry.path}.`);
  }

  const seasonEntry=cloneEntries[0];
  const originalFields=seasonEntry.fields;
  const releasedFields={...originalFields,rehearsalMarker:{stringValue:'release-candidate'}};
  const backupPath=`seasonSnapshotBackups/${cloneSeasonId}__rehearsal__publish`;
  await commit([{path:backupPath,fields:originalFields},{path:seasonEntry.path,fields:releasedFields}]);
  const released=await readDocument(seasonEntry.path);
  assert.equal(released.fields.rehearsalMarker?.stringValue,'release-candidate','Clone release marker was not committed.');

  const rescuePath=`seasonSnapshotBackups/${cloneSeasonId}__rehearsal__rollback`;
  await commit([{path:rescuePath,fields:released.fields},{path:seasonEntry.path,fields:originalFields}]);
  const restored=await readDocument(seasonEntry.path);
  assert.equal(fieldsHash(restored.fields||{}),fieldsHash(originalFields),'Clone rollback did not restore the original season exactly.');

  for(const entry of cloneEntries.slice(1)){
    const stored=await readDocument(entry.path);
    assert.equal(fieldsHash(stored.fields||{}),fieldsHash(entry.fields),`Pool data changed during rehearsal: ${entry.path}.`);
  }

  const collectionCounts={};
  for(const pool of checkpoint.pools||[]){
    for(const [collectionId,documents] of Object.entries(pool.collections||{})){
      collectionCounts[collectionId]=(collectionCounts[collectionId]||0)+documents.length;
    }
  }
  console.log(JSON.stringify({
    ok:true,
    sourceCheckpointSha256:hash(fs.readFileSync(checkpointPath)),
    documentsCloned:cloneEntries.length,
    poolsCloned:(checkpoint.pools||[]).length,
    collectionCounts,
    releaseCommit:'passed',
    rollbackRestore:'passed',
    sourceDataUnchanged:'passed',
  },null,2));
}

main().catch(error=>{
  console.error(error.stack||error.message);
  process.exitCode=1;
});
