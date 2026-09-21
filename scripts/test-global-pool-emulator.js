const assert=require('node:assert/strict');
const admin=require('../functions/node_modules/firebase-admin');
const {makeEngine}=require('../functions/shared/scoring-engine');

const projectId=process.env.GCLOUD_PROJECT||'demo-libapp';
const authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost=process.env.FIRESTORE_EMULATOR_HOST;
const functionsHost=process.env.FUNCTIONS_EMULATOR_HOST||'127.0.0.1:5001';
assert(authHost&&firestoreHost,'Run this walkthrough through the Auth, Firestore, and Functions emulators.');

admin.initializeApp({projectId});
const db=admin.firestore();
const auth=admin.auth();
const seasonId='love-is-blind-emulator-1';
const poolId=`global__${seasonId}`;
const settings={
  CONFIG_VERSION:'2',SEASON_STATUS:'live',AVAILABLE_THROUGH_EP:'5',
  PODS_START_EP:'1',PODS_END_EP:'5',DATING_START_EP:'5',DATING_END_EP:'7',
  RETREAT_START_EP:'5',RETREAT_END_EP:'7',WEDDINGS_START_EP:'7',WEDDINGS_END_EP:'9',
  REUNION_START_EP:'9',REUNION_END_EP:'10',PODS_RESULTS_READY:'TRUE',
  DATING_RESULTS_READY:'FALSE',WEDDINGS_RESULTS_READY:'FALSE',REUNION_RESULTS_READY:'FALSE',
};
const seasonDocument={
  id:seasonId,status:'live',label:'Love Is Blind Emulator',
  Settings:Object.entries(settings).map(([key,value])=>({key,value})),
  Cast:[{name:'Alex',gender:'M'},{name:'Casey',gender:'F'}],
  Couples:[{id:'alex-casey',him:'Alex',her:'Casey',engaged_ep:'2',pods_eligible:'TRUE',dating_eligible:'TRUE',reunion_status_eligible:'TRUE'}],
  'Dating Results':[],'Reunion Results':[],'Retro Events':[],
};
const engineConfig={
  CONFIG_VERSION:2,season:{id:seasonId,historical:false},SEASON_STATUS:'live',
  RULES:{POINTS_PER_HEART:1,K:1,LEAD_STEP:.5,WHO_TAG:.25,WEDDINGS_LEAD_STEP:.25,WEDDINGS_LEAD_CAP:1.75,phases:{pods:{budget:200,cap:60,label:'Pods'},dating:{budget:150,cap:40,label:'Retreats'},weddings:{budget:150,cap:80,label:'Weddings'},reunion:{budget:100,cap:40,label:'Reunion'}}},
  CAST:seasonDocument.Cast,MEN:['Alex'],WOMEN:['Casey'],COUPLES:[{id:'alex-casey',him:'Alex',her:'Casey',engagedEp:2,podsEligible:true,datingEligible:true,reunionStatusEligible:true,lockEp:9,lockEpFallback:true}],
  DATING_RESULTS:{sex:{},flirt:{},breakup:{}},REUNION_RESULTS:{still:{},back:{},newCouples:[],lifeUpdates:[],absent:[],ready:{still:true,back:true,newCouple:true,lifeUpdate:true,absent:true},placeholders:false},
  RETRO_EVENTS:[],PH_SPAN:{pods:{endEp:5},dating:{endEp:7,retreatStartEp:5,retreatEndEp:7},weddings:{endEp:9},reunion:{endEp:10}},
  PH_STARTW:{pods:1,dating:5,weddings:7,reunion:9},BOUNDARIES_FINAL:{pods:true,dating:true,weddings:true,reunion:true},
  RESULTS_READY:{pods:true,dating:false,weddings:false,reunion:false},AVAILABLE_THROUGH_EP:5,
  DATING_MULT:{sex:1,flirt:2,breakup:3},WED_MULT:{married:1,saysNo:1.5,calledOff:1.75},REU_MULT:{still:1,split:2,marriedSplit:2,back:2,newCouple:4.25,lifeUpdate:3.75,absent:2},
};

const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function waitFor(label,read,predicate,{timeoutMs=30000,intervalMs=200}={}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const value=await read();
    if(predicate(value))return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function createUser(email,username){
  const password='emulator-password-123';
  const user=await auth.createUser({email,password,emailVerified:true,displayName:username});
  await db.doc(`users/${user.uid}`).set({username,createdAt:Date.now()});
  const response=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),
  });
  const payload=await response.json();
  assert.equal(response.status,200,JSON.stringify(payload));
  return {uid:user.uid,token:payload.idToken,username};
}

async function call(functionName,user,data){
  const response=await fetch(`http://${functionsHost}/${projectId}/us-central1/${functionName}`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${user.token}`},
    body:JSON.stringify({data}),
  });
  const payload=await response.json();
  if(!response.ok||payload.error)throw new Error(`${functionName} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload.result;
}

async function main(){
  const first=await createUser('patrick@blxckmarketing.com','Admin Tester');
  const second=await createUser('global-walkthrough@example.test','Second Tester');
  await db.doc('appConfig/public').set({
    defaultSeasonId:seasonId,globalPoolSeasonId:seasonId,
    defaultSeason:{id:seasonId,label:'Love Is Blind Emulator',status:'live',releaseLabel:'Emulator'},
  });
  await db.doc(`seasons/${seasonId}`).set(seasonDocument);
  // Let the season-update trigger observe that no Global Pool exists yet. If
  // pool creation races it, that unrelated recompute pollutes the lock count.
  await sleep(4000);

  await call('openGlobalPool',first,{seasonId,initialWatchedThrough:0});
  await call('openGlobalPool',second,{seasonId,initialWatchedThrough:3});
  assert.equal((await db.doc(`pools/${poolId}/trustedPlayers/${second.uid}`).get()).data().watchedThrough,3);

  let standingsWrites=0;
  const stopStandings=db.doc(`pools/${poolId}/standings/current`).onSnapshot(snapshot=>{
    if(snapshot.exists)standingsWrites++;
  });
  const pick={c:'Alex|Casey',s:20,w:99};
  await Promise.all([
    call('openGlobalPool',first,{action:'lockGlobalPicks',poolId,phases:{pods:[pick]}}),
    call('openGlobalPool',second,{action:'lockGlobalPicks',poolId,phases:{pods:[pick]}}),
  ]);
  await waitFor('the coalesced lock rebuild',
    async()=>db.doc(`pools/${poolId}/standings/rebuild`).get(),
    snapshot=>snapshot.exists&&snapshot.data().lastCompletedAt,
  );
  await sleep(500);
  stopStandings();
  assert.equal(standingsWrites,1,'Two locks inside the 20-second window must produce one standings recompute.');

  await sleep(20500);
  const beforeCompletion=(await db.doc(`pools/${poolId}/standings/rebuild`).get()).data().lastCompletedAt.toMillis();
  await Promise.all([
    call('openGlobalPool',first,{action:'completeGlobalPhase',poolId,phase:'pods'}),
    call('openGlobalPool',second,{action:'completeGlobalPhase',poolId,phase:'pods'}),
  ]);
  await waitFor('the completed Pods standings',
    async()=>db.doc(`pools/${poolId}/standings/rebuild`).get(),
    snapshot=>snapshot.exists&&snapshot.data().lastCompletedAt?.toMillis()>beforeCompletion,
  );
  const [standingsSnapshot,rowSnapshot,trustedSnapshot]=await Promise.all([
    db.doc(`pools/${poolId}/standings/current`).get(),
    db.doc(`pools/${poolId}/standingsRows/${second.uid}`).get(),
    db.doc(`pools/${poolId}/trustedPlayers/${second.uid}`).get(),
  ]);
  assert(standingsSnapshot.exists&&rowSnapshot.exists);
  const standings=standingsSnapshot.data(),row=rowSnapshot.data(),trusted=trustedSnapshot.data();
  const receipt=makeEngine(engineConfig,Number(standings.activeCounts.pods)||1).scorePhase(
    'pods',{[second.uid]:trusted.picks.pods},
    {ownerCounts:standings.ownerCounts.pods,activeCount:standings.activeCounts.pods},
  );
  assert.equal(receipt.totals[second.uid],row.total,'The viewer receipt must equal the trusted personal standings-row total.');

  await call('leavePool',second,{poolId});
  assert(!(await db.doc(`pools/${poolId}`).get()).data().members.includes(second.uid));
  assert.equal((await db.doc(`pools/${poolId}/trustedPlayers/${second.uid}`).get()).exists,false);
  await call('openGlobalPool',second,{seasonId,initialWatchedThrough:3});
  assert((await db.doc(`pools/${poolId}`).get()).data().members.includes(second.uid));
  assert.equal((await db.doc(`pools/${poolId}/trustedPlayers/${second.uid}`).get()).data().watchedThrough,3);

  console.log('Two-account Global Pool emulator walkthrough passed.');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
