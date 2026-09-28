const fs=require('node:fs');
const path=require('node:path');

const PHASES=['pods','dating','weddings','reunion'];
const valueFor=(argv,flag)=>{const index=argv.indexOf(flag);return index>=0?argv[index+1]:undefined;};
const hasFlag=(argv,flag)=>argv.includes(flag);

function parseArgs(argv=process.argv.slice(2)){
  const known=new Set(['--project','--season','--phase','--reason','--backup','--expected-count','--apply']);
  argv.forEach((argument,index)=>{
    if(!argument.startsWith('--'))return;
    if(!known.has(argument))throw new Error(`Unknown argument: ${argument}`);
    if(argument!=='--apply'&&(argv[index+1]===undefined||argv[index+1].startsWith('--')))throw new Error(`${argument} requires a value.`);
  });
  const phase=String(valueFor(argv,'--phase')||'').trim();
  const expectedRaw=valueFor(argv,'--expected-count');
  return {
    projectId:String(valueFor(argv,'--project')||'lib-oauth').trim(),
    seasonId:String(valueFor(argv,'--season')||'').trim(),phase,
    reason:String(valueFor(argv,'--reason')||`unfreeze-${phase}`).trim(),
    backupPath:valueFor(argv,'--backup'),apply:hasFlag(argv,'--apply'),
    expectedCount:expectedRaw===undefined?null:Number(expectedRaw),
  };
}

function validateOptions(options,env=process.env){
  const emulatorHost=String(env.FIRESTORE_EMULATOR_HOST||'').trim();
  if(options.projectId!=='lib-oauth'&&!(options.projectId.startsWith('demo-')&&emulatorHost))throw new Error(`Refusing unexpected project: ${options.projectId}`);
  if(!/^[a-z0-9][a-z0-9-]{1,100}$/.test(options.seasonId))throw new Error('--season requires a valid season id.');
  if(!PHASES.includes(options.phase))throw new Error(`Unknown phase: ${options.phase||'(missing)'}`);
  if(!options.reason)throw new Error('--reason must not be empty.');
  if(!emulatorHost&&!env.FIREBASE_ACCESS_TOKEN)throw new Error('Set FIREBASE_ACCESS_TOKEN to a short-lived Google OAuth access token.');
  if(options.apply&&!options.backupPath)throw new Error('--apply requires --backup PATH.');
  if(options.apply&&(!Number.isInteger(options.expectedCount)||options.expectedCount<0))throw new Error('--apply requires --expected-count N.');
  return {...options,emulatorHost,accessToken:env.FIREBASE_ACCESS_TOKEN||''};
}

const mapFields=value=>value?.mapValue?.fields||{};
const fieldNumber=value=>{
  const raw=value?.integerValue??value?.doubleValue;
  const number=raw===undefined?NaN:Number(raw);
  return Number.isFinite(number)?number:null;
};
const documentId=document=>String(document?.name||'').split('/').pop();
const phaseMap=(document,field)=>mapFields(document?.fields?.[field]);
const phaseValue=(document,field,phase)=>fieldNumber(phaseMap(document,field)[phase]);

function selectAffectedRows(documents,phase){
  return (documents||[]).flatMap(document=>{
    const fields=phaseMap(document,'phaseScores');
    if(!Object.prototype.hasOwnProperty.call(fields,phase))return [];
    const score=fieldNumber(fields[phase]);
    if(score===null)throw new Error(`Invalid phaseScores.${phase} at ${document.name}.`);
    return [{document,uid:documentId(document),score,phasePoolSize:phaseValue(document,'phasePoolSizes',phase)}];
  });
}

function markerSummary(document){
  const fields=document?.fields||{};
  return {
    requestVersion:fieldNumber(fields.requestVersion)||0,
    handledRequestVersion:fieldNumber(fields.handledRequestVersion)||0,
    lastRunAt:fields.lastRunAt?.timestampValue||null,
    lastCompletedAt:fields.lastCompletedAt?.timestampValue||null,
    failureCount:fieldNumber(fields.failureCount)||0,
    lastError:fields.lastError?.stringValue||null,
    lastErrorAt:fields.lastErrorAt?.timestampValue||null,
  };
}

function rebuildIsRunning(document,nowMs=Date.now(),windowMs=6*60*1000){
  const summary=markerSummary(document),lastRunMs=Date.parse(summary.lastRunAt||''),lastCompletedMs=Date.parse(summary.lastCompletedAt||'');
  return Number.isFinite(lastRunMs)&&(!Number.isFinite(lastCompletedMs)||lastRunMs>lastCompletedMs)&&lastRunMs<=nowMs&&nowMs-lastRunMs<=windowMs;
}

function summarizePlan({rows,current,marker,phase}){
  const affected=selectAffectedRows(rows,phase);
  return {
    standingsRows:rows.length,affectedCount:affected.length,
    pointSum:affected.reduce((sum,row)=>sum+row.score,0),
    topTen:affected.slice().sort((a,b)=>b.score-a.score||a.uid.localeCompare(b.uid)).slice(0,10).map(({uid,score})=>({uid,score})),
    currentExists:!!current,marker:markerSummary(marker),
  };
}

function validateGlobalPoolDocument(document,seasonId){
  const fields=document?.fields||{};
  if(!document||fields.global?.booleanValue!==true||fields.globalSeasonId?.stringValue!==seasonId){
    throw new Error(`Refusing invalid Global Pool document for ${seasonId}.`);
  }
}

function buildRowDeleteWrite(row,phase){
  if(!row?.document?.name||!row.document.updateTime)throw new Error('Every affected standings row requires a name and updateTime precondition.');
  return {
    update:{name:row.document.name,fields:{}},
    updateMask:{fieldPaths:[`phaseScores.${phase}`,`phasePoolSizes.${phase}`]},
    currentDocument:{updateTime:row.document.updateTime},
  };
}

function buildFinalWrites({current,markerName,requestedAt,reason}){
  const writes=[];
  if(current)writes.push({delete:current.name,currentDocument:{updateTime:current.updateTime}});
  writes.push({
    update:{name:markerName,fields:{requestedAt:{timestampValue:requestedAt},reason:{stringValue:reason}}},
    updateMask:{fieldPaths:['requestedAt','reason']},
    updateTransforms:[{fieldPath:'requestVersion',increment:{integerValue:'1'}}],
  });
  return writes;
}

function rowsOverwrittenAfterStrip({affected,refreshed,writeUpdateTimes}){
  const refreshedByName=new Map((refreshed||[]).map(document=>[document.name,document]));
  return (affected||[]).flatMap(row=>{
    const expected=writeUpdateTimes?.[row.document.name],actual=refreshedByName.get(row.document.name)?.updateTime;
    return expected&&actual===expected?[]:[row.document.name];
  });
}

const encodedPath=documentPath=>documentPath.split('/').map(encodeURIComponent).join('/');

function createClient({projectId,emulatorHost,accessToken}){
  const database=`projects/${projectId}/databases/(default)`;
  const apiBase=emulatorHost?`http://${emulatorHost}/v1/${database}`:`https://firestore.googleapis.com/v1/${database}`;
  const headers={Authorization:`Bearer ${emulatorHost?'owner':accessToken}`,'Content-Type':'application/json'};
  async function request(url,options={},allowNotFound=false){
    const response=await fetch(url,{...options,headers:{...headers,...(options.headers||{})}});
    const text=await response.text();
    if(allowNotFound&&response.status===404)return null;
    if(!response.ok){
      const error=new Error(`${response.status} ${response.statusText}: ${text}`);
      error.status=response.status;error.responseText=text;throw error;
    }
    return text?JSON.parse(text):{};
  }
  return {
    database,
    documentName:documentPath=>`${database}/documents/${documentPath}`,
    readDocument:documentPath=>request(`${apiBase}/documents/${encodedPath(documentPath)}`,{},true),
    async listDocuments(collectionPath){
      const documents=[];let pageToken='';
      do{
        const suffix=`?pageSize=300${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`;
        const page=await request(`${apiBase}/documents/${encodedPath(collectionPath)}${suffix}`);
        documents.push(...(page.documents||[]));pageToken=page.nextPageToken||'';
      }while(pageToken);
      return documents;
    },
    commit:writes=>request(`${apiBase}/documents:commit`,{method:'POST',body:JSON.stringify({writes})}),
  };
}

function writeBackup({destination,projectId,seasonId,phase,affected,current,marker}){
  const resolved=path.resolve(destination);
  fs.mkdirSync(path.dirname(resolved),{recursive:true});
  fs.writeFileSync(resolved,JSON.stringify({
    projectId,seasonId,phase,createdAt:new Date().toISOString(),
    affectedRows:affected.map(row=>row.document),standingsCurrent:current,rebuildMarker:marker,
  },null,2),{mode:0o600});
  fs.chmodSync(resolved,0o600);
  return resolved;
}

const isPreconditionFailure=error=>[409,412].includes(error?.status)||/ABORTED|FAILED_PRECONDITION|precondition/i.test(String(error?.responseText||error?.message||''));
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function waitForRebuild({client,markerPath,currentPath,targetVersion,finalCommitTime,timeoutMs=180000,pollMs=2000}){
  const deadline=Date.now()+timeoutMs,finalCommitMs=Date.parse(finalCommitTime);
  let marker=null,current=null,summary=null;
  while(Date.now()<deadline){
    [marker,current]=await Promise.all([client.readDocument(markerPath),client.readDocument(currentPath)]);summary=markerSummary(marker);
    const computedField=current?.fields?.computedAt,computedNumber=fieldNumber(computedField);
    const computedAt=computedNumber??computedField?.timestampValue??null;
    const computedMs=computedNumber??Date.parse(computedAt||'');
    if(summary.handledRequestVersion>=targetVersion&&current&&Number.isFinite(computedMs)&&computedMs>finalCommitMs)return {marker,current,summary,computedAt};
    const lastErrorMs=Date.parse(summary.lastErrorAt||'');
    if(summary.lastError&&Number.isFinite(lastErrorMs)&&lastErrorMs>=finalCommitMs){
      throw new Error(`Global standings rebuild failed: ${summary.lastError}`);
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for Global standings rebuild.${summary?.lastError?` lastError: ${summary.lastError}`:''}`);
}

async function run({argv=process.argv.slice(2),env=process.env,output=console,verifyTimeoutMs=180000,pollMs=2000}={}){
  const options=validateOptions(parseArgs(argv),env),client=createClient(options);
  const poolId=`global__${options.seasonId}`;
  const poolPath=`pools/${poolId}`,rowsPath=`${poolPath}/standingsRows`;
  const currentPath=`${poolPath}/standings/current`,markerPath=`${poolPath}/standings/rebuild`;
  const [pool,rows,current,marker]=await Promise.all([
    client.readDocument(poolPath),client.listDocuments(rowsPath),client.readDocument(currentPath),client.readDocument(markerPath),
  ]);
  validateGlobalPoolDocument(pool,options.seasonId);
  const affected=selectAffectedRows(rows,options.phase);
  const summary=summarizePlan({rows,current,marker,phase:options.phase});
  output.log(JSON.stringify({mode:options.apply?'apply':'dry-run',projectId:options.projectId,seasonId:options.seasonId,phase:options.phase,...summary},null,2));
  if(!options.apply){
    if(options.backupPath)output.log(`Backup written to ${writeBackup({destination:options.backupPath,projectId:options.projectId,seasonId:options.seasonId,phase:options.phase,affected,current,marker})}`);
    return {mode:'dry-run',summary};
  }
  if(rebuildIsRunning(marker))throw new Error('A standings rebuild is running; wait a minute and retry.');
  if(affected.length!==options.expectedCount)throw new Error(`Refusing unfreeze: expected ${options.expectedCount} affected rows, found ${affected.length}.`);
  const backup=writeBackup({destination:options.backupPath,projectId:options.projectId,seasonId:options.seasonId,phase:options.phase,affected,current,marker});
  output.log(`Backup written to ${backup}`);
  let finalCommitTime=null;
  try{
    const rowWrites=affected.map(row=>buildRowDeleteWrite(row,options.phase));
    const writeUpdateTimes={};
    for(let index=0;index<rowWrites.length;index+=400){
      const chunkRows=affected.slice(index,index+400),result=await client.commit(rowWrites.slice(index,index+400));
      chunkRows.forEach((row,offset)=>{writeUpdateTimes[row.document.name]=result.writeResults?.[offset]?.updateTime||null;});
    }
    const postStripRows=await client.listDocuments(rowsPath);
    const overwritten=rowsOverwrittenAfterStrip({affected,refreshed:postStripRows,writeUpdateTimes});
    if(overwritten.length)throw new Error(`A standings rebuild overwrote ${overwritten.length} row${overwritten.length===1?'':'s'} after they were unfrozen. Re-run the dry run and apply again.`);
    const requestedAt=new Date().toISOString();
    const finalResult=await client.commit(buildFinalWrites({current,markerName:client.documentName(markerPath),requestedAt,reason:options.reason}));
    finalCommitTime=finalResult.commitTime||requestedAt;
  }catch(error){
    if(isPreconditionFailure(error))throw new Error('A Global standings rebuild ran mid-way. Some rows may already be unfrozen. Re-running the dry run and apply is safe.');
    throw error;
  }
  const targetVersion=markerSummary(marker).requestVersion+1;
  const rebuild=await waitForRebuild({client,markerPath,currentPath,targetVersion,finalCommitTime,timeoutMs:verifyTimeoutMs,pollMs});
  const refreshed=selectAffectedRows(await client.listDocuments(rowsPath),options.phase);
  const priorByName=new Map(affected.map(row=>[row.document.name,row.score]));
  const changedValues=refreshed.filter(row=>priorByName.has(row.document.name)&&priorByName.get(row.document.name)!==row.score).length;
  const verification={targetRequestVersion:targetVersion,handledRequestVersion:rebuild.summary.handledRequestVersion,rowsWithPhaseScore:refreshed.length,changedValues,computedAt:rebuild.computedAt,lastCompletedAt:rebuild.summary.lastCompletedAt,lastError:rebuild.summary.lastError};
  output.log(JSON.stringify({applied:affected.length,verification},null,2));
  return {mode:'apply',summary,verification,backup};
}

if(require.main===module)run().catch(error=>{console.error(error.message);process.exitCode=1;});

module.exports={
  PHASES,parseArgs,validateOptions,selectAffectedRows,markerSummary,summarizePlan,
  rebuildIsRunning,validateGlobalPoolDocument,buildRowDeleteWrite,buildFinalWrites,
  rowsOverwrittenAfterStrip,isPreconditionFailure,waitForRebuild,run,
};
