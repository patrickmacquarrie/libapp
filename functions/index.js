const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue,FieldPath}=require('firebase-admin/firestore');

initializeApp();
const db=getFirestore();
const PHASES=['pods','dating','weddings','reunion'];
const RATING_CATEGORIES=['hotness','humour','intelligence','vibes'];
const FUNCTION_LIMITS={minInstances:0,maxInstances:5};
const GLOBAL_POOL_ADMINS=new Set(['patrick@blxckmarketing.com']);
const APP_URL='https://patrickmacquarrie.github.io/libapp/';
const GLOBAL_POOL_SEASONS={
  'love-is-blind-us-6':{
    id:'love-is-blind-us-6',label:'Love Is Blind US: Season 6',country:'United States',countryCode:'US',
    seasonNumber:6,locationLabel:'Charlotte',
  },
};

function requireUser(request){
  if(!request.auth)throw new HttpsError('unauthenticated','Sign in to continue.');
  return request.auth.uid;
}

function escapeHtml(value){
  return String(value||'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

async function queueNudge(uid,messageId,subject,text){
  const preferences=await db.doc(`notificationPreferences/${uid}`).get();
  if(!preferences.exists||preferences.data().emailNudges!==true)return false;
  const user=await getAuth().getUser(uid).catch(()=>null);
  if(!user?.email)return false;
  const safeText=String(text||'');
  await db.doc(`mail/${messageId}`).set({
    to:[user.email],
    message:{
      subject,
      text:safeText+`\n\nOpen Through the Wall: ${APP_URL}`,
      html:`<p>${escapeHtml(safeText)}</p><p><a href="${APP_URL}">Open Through the Wall</a></p>`,
    },
  });
  return true;
}

function publishedSetting(snapshot,key){
  if(!snapshot||typeof snapshot!=='object')return null;
  const containers=[snapshot.Settings,snapshot.settings,snapshot.tabs?.Settings,snapshot.tabs?.settings,snapshot.sheets?.Settings,snapshot.data?.Settings].filter(Boolean);
  for(const rawValue of containers){
    const raw=rawValue?.rows||rawValue?.values||rawValue?.data||rawValue;
    if(Array.isArray(raw)){
      for(const row of raw){
        if(Array.isArray(row)&&String(row[0]||'').trim()===key)return row[1];
        if(row&&typeof row==='object'&&String(row.key||'').trim()===key)return row.value;
      }
    }else if(raw&&typeof raw==='object'&&raw[key]!=null)return raw[key];
  }
  return snapshot[key]??null;
}

function cleanRatings(value){
  return (Array.isArray(value)?value:[]).slice(0,80).map(entry=>{
    const values={};
    RATING_CATEGORIES.forEach(category=>{
      const score=Number(entry?.values?.[category]);
      if(Number.isInteger(score)&&score>=0&&score<=10)values[category]=score;
    });
    return {name:String(entry?.name||'').trim().slice(0,80),gender:['M','F'].includes(entry?.gender)?entry.gender:'',values};
  }).filter(entry=>entry.name&&Object.keys(entry.values).length);
}

function ratingMetrics(entry){
  const metrics={};
  RATING_CATEGORIES.forEach(category=>{
    const value=Number(entry?.values?.[category]);
    if(Number.isInteger(value)&&value>=0&&value<=10)metrics[category]=value;
  });
  if(RATING_CATEGORIES.every(category=>Number.isInteger(metrics[category])))metrics.overall=RATING_CATEGORIES.reduce((sum,category)=>sum+metrics[category],0);
  return metrics;
}

function updateAggregate(current,previousRatings,nextRatings){
  const rows=new Map((Array.isArray(current?.cast)?current.cast:[]).map(row=>[String(row.name||'').trim().toLowerCase(),{
    name:String(row.name||'').trim(),gender:['M','F'].includes(row.gender)?row.gender:'',totals:{...(row.totals||{})},counts:{...(row.counts||{})},
  }]));
  const apply=(ratings,direction)=>cleanRatings(ratings).forEach(entry=>{
    const key=entry.name.toLowerCase();
    const row=rows.get(key)||{name:entry.name,gender:entry.gender,totals:{},counts:{}};
    row.name=entry.name;row.gender=entry.gender||row.gender;
    Object.entries(ratingMetrics(entry)).forEach(([metric,value])=>{
      row.totals[metric]=Math.max(0,(Number(row.totals[metric])||0)+direction*value);
      row.counts[metric]=Math.max(0,(Number(row.counts[metric])||0)+direction);
    });
    rows.set(key,row);
  });
  apply(previousRatings,-1);apply(nextRatings,1);
  return [...rows.values()].filter(row=>Object.values(row.counts).some(count=>count>0)).sort((a,b)=>a.name.localeCompare(b.name));
}

exports.aggregateCastRatings=onDocumentWritten({...FUNCTION_LIMITS,document:'castRatingProfiles/{uid}/seasons/{seasonId}'},async event=>{
  const before=event.data?.before.exists?event.data.before.data():{};
  const after=event.data?.after.exists?event.data.after.data():{};
  const previous=cleanRatings(before.globalRatings);
  const next=cleanRatings(after.globalRatings);
  if(JSON.stringify(previous)===JSON.stringify(next))return;
  const ref=db.doc(`castRatingAggregates/${event.params.seasonId}`);
  await db.runTransaction(async tx=>{
    const snapshot=await tx.get(ref);
    const aggregate=snapshot.exists?snapshot.data():{};
    const participantCount=Math.max(0,(Number(aggregate.participantCount)||0)+(next.length?1:0)-(previous.length?1:0));
    tx.set(ref,{seasonId:event.params.seasonId,cast:updateAggregate(aggregate,previous,next),participantCount,updatedAt:Date.now()});
  });
});

exports.sendPhaseLockNudges=onDocumentWritten({...FUNCTION_LIMITS,document:'pools/{poolId}/phaseStatus/{phase}'},async event=>{
  const after=event.data?.after.exists?event.data.after.data():null;
  if(!after)return;
  const beforeMembers=new Set(event.data?.before.exists?(event.data.before.data().completedMembers||[]):[]);
  const newlyLocked=(after.completedMembers||[]).filter(uid=>!beforeMembers.has(uid));
  if(!newlyLocked.length)return;
  const poolSnapshot=await db.doc(`pools/${event.params.poolId}`).get();
  if(!poolSnapshot.exists||poolSnapshot.data().global===true)return;
  const pool=poolSnapshot.data(),phase=event.params.phase;
  const phaseLabel={pods:'Pods',dating:'Retreats',weddings:'Weddings',reunion:'Reunion'}[phase]||phase;
  for(const lockerUid of newlyLocked){
    const profile=await db.doc(`users/${lockerUid}`).get();
    const lockerName=profile.data()?.username||'A friend';
    const recipients=(Array.isArray(pool.members)?pool.members:[]).filter(uid=>uid!==lockerUid);
    await Promise.all(recipients.map(uid=>queueNudge(
      uid,
      `phase_${event.params.poolId}_${phase}_${lockerUid}_${uid}`,
      `${lockerName} locked their ${phaseLabel} picks`,
      `${lockerName} just locked their ${phaseLabel} picks in ${pool.name}. The tea is moving.`,
    )));
  }
});

exports.sendNewEpisodeNudges=onDocumentWritten({...FUNCTION_LIMITS,document:'seasons/{seasonId}'},async event=>{
  if(!event.data?.after.exists)return;
  const before=event.data?.before.exists?event.data.before.data():{};
  const after=event.data.after.data();
  const beforeEpisode=Number(publishedSetting(before,'AVAILABLE_THROUGH_EP'))||0;
  const afterEpisode=Number(publishedSetting(after,'AVAILABLE_THROUGH_EP'))||0;
  if(afterEpisode<=beforeEpisode)return;
  const pools=await db.collection('pools').where('season.id','==',event.params.seasonId).get();
  const recipients=new Set();pools.docs.forEach(pool=>{(pool.data().members||[]).forEach(uid=>recipients.add(uid));});
  await Promise.all([...recipients].map(uid=>queueNudge(
    uid,
    `episodes_${event.params.seasonId}_${afterEpisode}_${uid}`,
    'New episodes are out — your picks are waiting',
    `New episodes are out through Episode ${afterEpisode}. Your picks are waiting before you watch.`,
  )));
});

async function removeMemberData(poolRef,uid){
  const batch=db.batch();
  batch.delete(poolRef.collection('players').doc(uid));
  batch.delete(poolRef.collection('castRatings').doc(uid));
  PHASES.forEach(phase=>{
    batch.delete(poolRef.collection('phasePicks').doc(`${phase}__${uid}`));
    batch.set(poolRef.collection('phaseStatus').doc(phase),{completedMembers:FieldValue.arrayRemove(uid),updatedAt:Date.now()},{merge:true});
  });
  await batch.commit();
}

exports.leavePool=onCall(FUNCTION_LIMITS,async request=>{
  const uid=requireUser(request);
  const poolId=String(request.data?.poolId||'');
  if(!poolId)throw new HttpsError('invalid-argument','Choose a pool to leave.');
  const poolRef=db.doc(`pools/${poolId}`);
  const snapshot=await poolRef.get();
  if(!snapshot.exists)throw new HttpsError('not-found','This pool no longer exists.');
  const pool=snapshot.data();
  if(pool.global===true){
    await poolRef.collection('members').doc(uid).delete().catch(()=>{});
    if(Array.isArray(pool.members)&&pool.members.includes(uid))await poolRef.update({members:FieldValue.arrayRemove(uid)});
  }else{
    if(pool.ownerUid===uid)throw new HttpsError('failed-precondition','Delete the pool or transfer ownership before leaving it.');
    if(!Array.isArray(pool.members)||!pool.members.includes(uid))throw new HttpsError('permission-denied','You are not a member of this pool.');
    await poolRef.update({members:FieldValue.arrayRemove(uid)});
  }
  await removeMemberData(poolRef,uid);
  return {ok:true};
});

exports.sendPoolInvite=onCall(FUNCTION_LIMITS,async request=>{
  const uid=requireUser(request);
  const poolId=String(request.data?.poolId||'');
  const toEmail=String(request.data?.toEmail||'').trim().toLowerCase();
  if(!poolId||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail))throw new HttpsError('invalid-argument','Enter a valid email address.');
  const poolRef=db.doc(`pools/${poolId}`);
  const poolSnap=await poolRef.get();
  if(!poolSnap.exists||poolSnap.data().ownerUid!==uid)throw new HttpsError('permission-denied','Only the pool owner can email invitations.');
  if(poolSnap.data().membershipClosed===true)throw new HttpsError('failed-precondition','This pool is locked for new players.');
  const day=new Date().toISOString().slice(0,10);
  const limitRef=db.doc(`inviteRateLimits/${uid}__${day}`);
  const profileSnap=await db.doc(`users/${uid}`).get();
  await db.runTransaction(async tx=>{
    const limitSnap=await tx.get(limitRef);
    const count=Number(limitSnap.data()?.count)||0;
    if(count>=10)throw new HttpsError('resource-exhausted','You have reached today’s invitation limit. Share the pool link instead.');
    const pool=poolSnap.data();
    const inviteRef=db.doc(`invites/${poolId}__${toEmail}`);
    const existing=await tx.get(inviteRef);
    if(existing.exists&&existing.data().status!=='pending')throw new HttpsError('already-exists','That invitation was already answered. Share the pool link instead.');
    tx.set(inviteRef,{poolId,poolName:pool.name,seasonLabel:pool.season?.label||'',fromUid:uid,fromUsername:profileSnap.data()?.username||'A friend',toEmail,status:'pending',createdAt:Date.now()});
    tx.set(limitRef,{uid,day,count:count+1,updatedAt:Date.now()},{merge:true});
  });
  return {ok:true};
});

exports.openGlobalPool=onCall(FUNCTION_LIMITS,async request=>{
  const uid=requireUser(request);
  const email=String(request.auth.token?.email||'').trim().toLowerCase();
  const seasonId=String(request.data?.seasonId||'');
  const season=GLOBAL_POOL_SEASONS[seasonId];
  if(!season)throw new HttpsError('invalid-argument','That season is not approved for the global pool.');
  const ref=db.doc(`pools/global__${seasonId}`);
  await db.runTransaction(async tx=>{
    const snapshot=await tx.get(ref);
    if(snapshot.exists){
      const current=snapshot.data();
      if(current.global!==true||current.globalSeasonId!==seasonId)throw new HttpsError('failed-precondition','The global pool document is configured incorrectly.');
      if(!Array.isArray(current.members)||!current.members.includes(uid))tx.update(ref,{members:FieldValue.arrayUnion(uid)});
      return;
    }
    if(!GLOBAL_POOL_ADMINS.has(email))throw new HttpsError('permission-denied','The app administrator needs to open this global pool first.');
    tx.create(ref,{
      name:`Global Pool · ${season.label}`,ownerUid:uid,members:[uid],global:true,globalSeasonId:seasonId,
      membershipClosed:false,season,rulesSnapshot:null,createdAt:Date.now(),
    });
  });
  return {ok:true,poolId:ref.id};
});

exports.deleteMyAccount=onCall(FUNCTION_LIMITS,async request=>{
  const uid=requireUser(request);
  const pools=await db.collection('pools').where('members','array-contains',uid).get();
  for(const poolDoc of pools.docs){
    if(poolDoc.data().ownerUid===uid&&poolDoc.data().global!==true)await db.recursiveDelete(poolDoc.ref);
    else{
      await poolDoc.ref.update({members:FieldValue.arrayRemove(uid)});
      await removeMemberData(poolDoc.ref,uid);
    }
  }
  const globalMemberships=await db.collectionGroup('members').where('uid','==',uid).get();
  await Promise.all(globalMemberships.docs.map(member=>member.ref.delete()));
  await db.recursiveDelete(db.doc(`castRatingProfiles/${uid}`));
  await db.doc(`notificationPreferences/${uid}`).delete().catch(()=>{});
  await db.doc(`users/${uid}`).delete().catch(()=>{});
  await getAuth().deleteUser(uid);
  return {ok:true};
});
