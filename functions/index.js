const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {defineString,defineSecret}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue,FieldPath}=require('firebase-admin/firestore');
const {makeEngine,PH_ORDER,DEFAULT_DATING_MULT,DEFAULT_WED_MULT,DEFAULT_REU_MULT,validateLockedPhasePicks,freezeScoredTotal}=require('./shared/scoring-engine');
const {advanceGlobalWatchValue,globalLedgerFieldsForJoin,globalWatchLedgerReady,resolveGlobalWatchWindow}=require('./shared/global-watch-ledger');
const {safeHeaderText,stripLinkText}=require('./shared/link-text');
const {PREFERENCE_LABELS,signEmailPreferenceToken,verifyEmailPreferenceToken,emailPreferencesUrl,buildEmailFooter}=require('./shared/email-preferences');
const crypto=require('node:crypto');

initializeApp();
const db=getFirestore();
const PHASES=['pods','dating','weddings','reunion'];
const GLOBAL_SCORING_VERSION=1;
const STANDINGS_DOCUMENT_SOFT_LIMIT=850000;
const GLOBAL_STANDINGS_ROW_LIMIT=500;
const STANDINGS_REBUILD_COOLDOWN_MS=20000;
const GLOBAL_JOIN_CEILING=8000;
const FRIEND_POOL_MEMBER_LIMIT=40;
const MAIL_PROJECT_DAILY_LIMIT=1500; // Resend Free: 80
const INVITE_PROJECT_DAILY_LIMIT=600; // Resend Free: 50
const RATING_CATEGORIES=['hotness','humour','intelligence','vibes'];
const FUNCTION_LIMITS={minInstances:0,maxInstances:5};
// The Firebase emulator cannot mint App Check tokens. Keep enforcement on in
// every deployed environment while allowing authenticated integration tests.
const CALLABLE_LIMITS={...FUNCTION_LIMITS,enforceAppCheck:process.env.FUNCTIONS_EMULATOR!=='true'};
const MAIL_POSTAL_ADDRESS=defineString('MAIL_POSTAL_ADDRESS');
const EMAIL_PREFERENCES_SECRET=defineSecret('EMAIL_PREFERENCES_SECRET');
const MAIL_FUNCTION_LIMITS={...FUNCTION_LIMITS,secrets:[EMAIL_PREFERENCES_SECRET]};
const MAIL_CALLABLE_LIMITS={...CALLABLE_LIMITS,secrets:[EMAIL_PREFERENCES_SECRET]};
const GLOBAL_POOL_ADMINS=new Set(['patrick@blxckmarketing.com']);
const APP_URL='https://throughthewall.ca/';
// Resend lets us use these clear sender identities because throughthewall.ca
// is a verified sending domain. Replies route through the support address.
const MAIL_SENDERS={
  invites:'Through the Wall Invites <invites@throughthewall.ca>',
  updates:'Through the Wall Updates <updates@throughthewall.ca>',
  support:'Through the Wall Support <support@throughthewall.ca>',
};
const MAIL_REPLY_TO='support@throughthewall.ca';

function requireUser(request){
  if(!request.auth)throw new HttpsError('unauthenticated','Sign in to continue.');
  return request.auth.uid;
}
function isGlobalPoolAdmin(request){
  const email=String(request.auth?.token?.email||'').trim().toLowerCase();
  return request.auth?.token?.email_verified===true&&GLOBAL_POOL_ADMINS.has(email);
}

function escapeHtml(value){
  return String(value||'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
const firestoreMillis=value=>typeof value?.toMillis==='function'?value.toMillis():value instanceof Date?value.getTime():Number(value)||0;
const boundedGlobalStandingsRows=(rows,limit=GLOBAL_STANDINGS_ROW_LIMIT)=>({
  rows:(Array.isArray(rows)?rows:[]).slice(0,limit),
  rowCount:Array.isArray(rows)?rows.length:0,
  truncated:Array.isArray(rows)&&rows.length>limit,
});
const globalJoinHasCapacity=(members,uid,ceiling=GLOBAL_JOIN_CEILING)=>{
  const current=Array.isArray(members)?members:[];
  return current.includes(uid)||current.length<ceiling;
};
const abortedFirestoreWrite=error=>['10','aborted'].includes(String(error?.code??'').toLowerCase());
async function retryAborted(operation,attempts=3){
  let lastError;
  for(let attempt=0;attempt<attempts;attempt++){
    try{return await operation();}
    catch(error){
      lastError=error;
      if(!abortedFirestoreWrite(error)||attempt===attempts-1)throw error;
      await new Promise(resolve=>setTimeout(resolve,Math.min(1600,100*2**attempt)+Math.floor(Math.random()*150)));
    }
  }
  throw lastError;
}

function globalPoolSeasonFromConfig(data){
  const configured=data?.defaultSeason&&typeof data.defaultSeason==='object'?data.defaultSeason:{};
  const id=safeHeaderText(data?.globalPoolSeasonId,100);
  if(!id)throw new HttpsError('failed-precondition','The Global Pool season is not configured');
  return {
    id,
    label:safeHeaderText(configured.label||data?.defaultSeasonLabel||id,100),
    country:safeHeaderText(configured.country,80),
    countryCode:safeHeaderText(configured.countryCode,8),
    seasonNumber:Number.isFinite(Number(configured.seasonNumber))?Number(configured.seasonNumber):0,
    locationLabel:safeHeaderText(configured.locationLabel,80)||null,
    status:safeHeaderText(configured.status||data?.status,30)||'upcoming',
    releaseLabel:safeHeaderText(configured.releaseLabel,160),
  };
}

function nudgePreferenceEnabled(preferences,key){
  if(preferences?.[key]===true)return true;
  if(preferences?.[key]===false)return false;
  return preferences?.emailNudges===true&&['newEpisodes','friendPhaseLocks'].includes(key);
}

const utcDay=now=>new Date(now).toISOString().slice(0,10);
const emailHash=email=>crypto.createHash('sha256').update(String(email||'').trim().toLowerCase()).digest('hex');
const mailCounterRef=now=>db.doc(`emailDailyCounts/${utcDay(now)}`);
const mailUnsubscribeHeaders=token=>({'List-Unsubscribe':`<${emailPreferencesUrl(token)}>, <mailto:support@throughthewall.ca?subject=unsubscribe>`});

async function reserveMailBudget(n){
  const requested=Math.max(0,Math.trunc(Number(n)||0)),now=Date.now(),ref=mailCounterRef(now);
  return db.runTransaction(async tx=>{
    const snapshot=await tx.get(ref),data=snapshot.exists?snapshot.data():{};
    const count=Math.max(0,Number(data.count)||0),granted=Math.max(0,Math.min(requested,MAIL_PROJECT_DAILY_LIMIT-count));
    tx.set(ref,{count:count+granted,invites:Math.max(0,Number(data.invites)||0),updatedAt:now},{merge:true});
    return granted;
  });
}

async function queueNudgeForUser(user,messageId,subject,text,preferenceKey){
  if(!user?.email)return false;
  const safeText=String(text||'');
  const token=signEmailPreferenceToken({v:1,t:'nudge',u:user.uid,p:preferenceKey},EMAIL_PREFERENCES_SECRET.value());
  const preferencesUrl=emailPreferencesUrl(token);
  const footer=buildEmailFooter({kind:'nudge',preferenceLabel:PREFERENCE_LABELS[preferenceKey],postalAddress:MAIL_POSTAL_ADDRESS.value(),preferencesUrl});
  try{
    await db.doc(`mail/${messageId}`).create({
      to:[user.email],
      from:MAIL_SENDERS.updates,
      replyTo:MAIL_REPLY_TO,
      headers:mailUnsubscribeHeaders(token),
      message:{
        subject,
        text:safeText+`\n\nOpen Through the Wall: ${APP_URL}\n\n${footer.text}`,
        html:`<p>${escapeHtml(safeText)}</p><p><a href="${APP_URL}">Open Through the Wall</a></p>${footer.html}`,
      },
    });
  }catch(error){
    const code=String(error?.code??'').toLowerCase();
    if(code==='6'||code==='already-exists'||code==='already_exists')return true;
    throw error;
  }
  return true;
}

async function queueNudge(uid,messageId,subject,text,preferenceKey){
  const preferences=await db.doc(`notificationPreferences/${uid}`).get();
  if(!preferences.exists||!nudgePreferenceEnabled(preferences.data(),preferenceKey))return false;
  const user=await getAuth().getUser(uid).catch(()=>null);
  return queueNudgeForUser(user,messageId,subject,text,preferenceKey);
}

async function enabledNotificationRecipients(preferenceKey){
  const queries=[db.collection('notificationPreferences').where(preferenceKey,'==',true)];
  if(preferenceKey==='newEpisodes')queries.push(db.collection('notificationPreferences').where('emailNudges','==',true));
  const snapshots=await Promise.all(queries.map(query=>query.get()));
  const preferences=new Map();
  snapshots.forEach(snapshot=>snapshot.docs.forEach(document=>preferences.set(document.id,document.data())));
  return [...preferences.entries()].filter(([,data])=>nudgePreferenceEnabled(data,preferenceKey)).map(([uid])=>uid);
}

async function queueNudgeChunks(uids,messageFor){
  const sent=new Set(),unique=[...new Set(uids)];
  for(let offset=0;offset<unique.length;offset+=50){
    const chunk=unique.slice(offset,offset+50);
    const granted=await reserveMailBudget(chunk.length);
    const approved=chunk.slice(0,granted);
    if(granted<chunk.length)console.warn(`Daily mail ceiling skipped ${chunk.length-granted} nudge email(s).`);
    if(!approved.length)continue;
    const result=await getAuth().getUsers(approved.map(uid=>({uid})));
    await Promise.all(result.users.map(async user=>{
      const message=messageFor(user.uid);
      if(message&&await queueNudgeForUser(user,message.id,message.subject,message.text,message.preferenceKey))sent.add(user.uid);
    }));
  }
  return sent;
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

function publishedBool(value,fallback=false){
  if(value==null||value==='')return fallback;
  if(typeof value==='boolean')return value;
  return ['true','1','yes','y'].includes(String(value).trim().toLowerCase());
}

const normalizedKey=value=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');

function publishedRows(snapshot,tabName){
  const wanted=normalizedKey(tabName).replaceAll('_','');
  const containers=[snapshot,snapshot?.tabs,snapshot?.sheets,snapshot?.data,snapshot?.sheetData].filter(value=>value&&typeof value==='object');
  let raw=null;
  for(const container of containers){
    const key=Object.keys(container).find(candidate=>normalizedKey(candidate).replaceAll('_','')===wanted);
    if(key){raw=container[key];break;}
  }
  if(raw&&typeof raw==='object'&&!Array.isArray(raw))raw=raw.rows||raw.values||raw.data||raw;
  if(!Array.isArray(raw))return [];
  if(raw.every(row=>row&&typeof row==='object'&&!Array.isArray(row))){
    return raw.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[normalizedKey(key),value])));
  }
  if(!raw.length||!Array.isArray(raw[0]))return [];
  const headers=raw[0].map(normalizedKey);
  return raw.slice(1).filter(row=>Array.isArray(row)&&row.some(value=>value!==''&&value!=null)).map(row=>
    Object.fromEntries(headers.map((header,index)=>[header,row[index]??'']))
  );
}

function publishedSeasonConfig(snapshot,seasonId){
  const settings=Object.fromEntries(publishedRows(snapshot,'Settings').map(row=>[String(row.key||'').trim(),row.value]));
  const numberSetting=(key,fallback,integer=false)=>{
    const parsed=integer?Number.parseInt(settings[key],10):Number.parseFloat(settings[key]);
    return Number.isFinite(parsed)?parsed:fallback;
  };
  const boolSetting=(key,fallback)=>settings[key]==null||settings[key]===''?fallback:publishedBool(settings[key],fallback);
  // Missing CONFIG_VERSION intentionally retains the production interpretation
  // used by UK3. Corrected blank-value defaults are opt-in for new seasons.
  const configVersion=numberSetting('CONFIG_VERSION',1,true);
  const seasonStatus=String(publishedSetting(snapshot,'SEASON_STATUS')||snapshot.status||'').trim().toLowerCase();
  const phaseStart={
    pods:numberSetting('PODS_START_EP',1,true),
    dating:numberSetting('DATING_START_EP',5,true),
    weddings:numberSetting('WEDDINGS_START_EP',9,true),
    reunion:numberSetting('REUNION_START_EP',12,true),
  };
  const phaseSpan={
    pods:{endEp:numberSetting('PODS_END_EP',6,true)},
    dating:{
      endEp:numberSetting('DATING_END_EP',9,true),
      retreatStartEp:numberSetting('RETREAT_START_EP',phaseStart.dating,true),
      retreatEndEp:numberSetting('RETREAT_END_EP',numberSetting('DATING_END_EP',9,true),true),
    },
    weddings:{endEp:numberSetting('WEDDINGS_END_EP',12,true)},
    reunion:{endEp:numberSetting('REUNION_END_EP',13,true)},
  };
  const rules={
    POINTS_PER_HEART:1,K:numberSetting('K',1),LEAD_STEP:numberSetting('LEAD_STEP',.5),WHO_TAG:numberSetting('WHO_TAG',.25),
    WEDDINGS_LEAD_STEP:Math.max(0,numberSetting('WEDDINGS_LEAD_STEP',.25)),
    WEDDINGS_LEAD_CAP:Math.max(1,numberSetting('WEDDINGS_LEAD_CAP',1.75)),
    phases:{
      pods:{budget:numberSetting('PODS_BUDGET',200,true),cap:numberSetting('PODS_CAP',60,true),label:'Pods'},
      dating:{budget:numberSetting('DATING_BUDGET',150,true),cap:numberSetting('DATING_CAP',40,true),label:'Retreats'},
      weddings:{budget:numberSetting('WEDDINGS_BUDGET',150,true),cap:numberSetting('WEDDINGS_CAP',80,true),label:'Weddings'},
      reunion:{budget:numberSetting('REUNION_BUDGET',100,true),cap:numberSetting('REUNION_CAP',40,true),label:'Reunion'},
    },
  };
  const cast=publishedRows(snapshot,'Cast').map(row=>({name:String(row.name||'').trim(),gender:String(row.gender||'').trim().toUpperCase()})).filter(person=>person.name);
  const couples=publishedRows(snapshot,'Couples').map(row=>{
    const engagedEp=Number.parseInt(row.engaged_ep,10),settledEp=Number.parseInt(row.settled_ep,10),breakupEp=Number.parseInt(row.breakup_ep,10);
    const lockEp=Number.parseInt(row.lock_ep,10);
    const wedding=String(row.wedding||'').trim()||undefined;
    return {
      id:String(row.id||'').trim(),him:String(row.him||'').trim(),her:String(row.her||'').trim(),
      engagedEp:Number.isFinite(engagedEp)?engagedEp:undefined,
      weddingEligibleFromEp:Number.isFinite(engagedEp)?engagedEp:(wedding?phaseStart.weddings:undefined),
      podsEligible:Number.isFinite(engagedEp)&&(row.pods_eligible==null||row.pods_eligible===''?true:publishedBool(row.pods_eligible)),
      datingEligible:row.dating_eligible==null||row.dating_eligible===''?true:publishedBool(row.dating_eligible),
      reunionStatusEligible:row.reunion_status_eligible==null||row.reunion_status_eligible===''?configVersion<2:publishedBool(row.reunion_status_eligible),
      wedding,who:String(row.who_says_no||'').trim()||undefined,
      breakupEp:Number.isFinite(breakupEp)?breakupEp:undefined,settledEp:Number.isFinite(settledEp)?settledEp:undefined,
      togetherNow:row.together_now==null||row.together_now===''?undefined:publishedBool(row.together_now),
      lockEp:Number.isFinite(lockEp)?Math.min(lockEp,phaseSpan.weddings.endEp):phaseSpan.weddings.endEp,
      lockEpFallback:!Number.isFinite(lockEp),
    };
  }).filter(couple=>couple.id&&couple.him&&couple.her);
  const datingResults={sex:{},flirt:{},breakup:{}};
  publishedRows(snapshot,'Dating Results').forEach(row=>{
    const market=String(row.market||'').trim().toLowerCase();
    const target=market==='flirt'?String(row.person||'').trim():String(row.couple_id||'').trim();
    const ep=Number.parseInt(row.episode,10);
    if(Object.prototype.hasOwnProperty.call(datingResults,market)&&target&&Number.isFinite(ep))datingResults[market][target]={ep,confirmed:publishedBool(row.confirmed)};
  });
  const reunionResults={still:{},back:{},newCouples:[],lifeUpdates:[],absent:[],ready:{still:true,back:true,newCouple:true,lifeUpdate:true,absent:true},placeholders:false};
  publishedRows(snapshot,'Reunion Results').forEach(row=>{
    const market=String(row.market||'').trim().toLowerCase();
    const target=String(row.couple_person_id_or_name||'').trim(),value=String(row.value||'').trim();
    if(!target||['COMPLETE','FINAL','NONE'].includes(target.toUpperCase()))return;
    if(market==='still')reunionResults.still[target]=publishedBool(value);
    else if(market==='back'&&(!value||publishedBool(value)))reunionResults.back[target]=true;
    else if(market==='newcouple')reunionResults.newCouples.push(target);
    else if(market==='lifeupdate'&&value)reunionResults.lifeUpdates.push({person:target,update:({engagedNew:'newPartner',marriedNew:'newPartner',kid:'newBaby'}[value]||value)});
    else if(market==='absent')reunionResults.absent.push(target);
  });
  const revealingPhaseForEpisode=episode=>[...PHASES].reverse().find(phase=>episode>phaseStart[phase]&&episode<=phaseSpan[phase].endEp);
  const retroEvents=publishedRows(snapshot,'Retro Events').map((row,index)=>{
    const market=String(row.market||'').trim().toLowerCase();
    const target=String(row.target||'').trim();
    const voidMarket=String(row.void_market||'').trim().toLowerCase();
    const appliesPhase=String(row.applies_phase||'').trim().toLowerCase();
    const revealedEp=Number.parseInt(row.revealed_ep,10);
    const revealingPhase=revealingPhaseForEpisode(revealedEp);
    if(!['pods','sex','flirt','breakup','still','void'].includes(market)||!PHASES.includes(appliesPhase)||!target||!revealingPhase)return null;
    return {id:`retro-${index+1}`,market,target,voidMarket,appliesPhase,revealedEp,note:String(row.note||'').trim(),confirmed:publishedBool(row.confirmed),revealingPhase};
  }).filter(Boolean);
  const availableThroughEp=numberSetting('AVAILABLE_THROUGH_EP',0,true);
  return {
    season:{id:seasonId,historical:seasonStatus==='completed'},CONFIG_VERSION:configVersion,
    RULES:rules,CAST:cast,MEN:cast.filter(person=>person.gender==='M').map(person=>person.name),WOMEN:cast.filter(person=>person.gender==='F').map(person=>person.name),
    COUPLES:couples,DATING_RESULTS:datingResults,REUNION_RESULTS:reunionResults,RETRO_EVENTS:retroEvents,PH_SPAN:phaseSpan,PH_STARTW:phaseStart,
    BOUNDARIES_FINAL:Object.fromEntries(PHASES.map(phase=>[phase,boolSetting(`${phase.toUpperCase()}_BOUNDARY_FINAL`,true)])),
    RESULTS_READY:Object.fromEntries(PHASES.map(phase=>[phase,boolSetting(`${phase.toUpperCase()}_RESULTS_READY`,configVersion>=2?seasonStatus==='completed':true)])),
    AVAILABLE_THROUGH_EP:availableThroughEp,SEASON_STATUS:seasonStatus,
    DATING_MULT:{sex:numberSetting('DATING_SEX_MULT',DEFAULT_DATING_MULT.sex),flirt:numberSetting('DATING_FLIRT_MULT',DEFAULT_DATING_MULT.flirt),breakup:numberSetting('DATING_BREAKUP_MULT',DEFAULT_DATING_MULT.breakup)},
    WED_MULT:{married:numberSetting('WEDDINGS_MARRIED_MULT',DEFAULT_WED_MULT.married),saysNo:numberSetting('WEDDINGS_SAYS_NO_MULT',DEFAULT_WED_MULT.saysNo),calledOff:numberSetting('WEDDINGS_CALLED_OFF_MULT',DEFAULT_WED_MULT.calledOff)},
    REU_MULT:{still:numberSetting('REUNION_STILL_MULT',DEFAULT_REU_MULT.still),split:numberSetting('REUNION_SPLIT_MULT',DEFAULT_REU_MULT.split),marriedSplit:numberSetting('REUNION_MARRIED_SPLIT_MULT',DEFAULT_REU_MULT.marriedSplit),back:numberSetting('REUNION_BACK_MULT',DEFAULT_REU_MULT.back),newCouple:numberSetting('REUNION_NEW_COUPLE_MULT',DEFAULT_REU_MULT.newCouple),lifeUpdate:numberSetting('REUNION_LIFE_UPDATE_MULT',DEFAULT_REU_MULT.lifeUpdate),absent:numberSetting('REUNION_ABSENT_MULT',DEFAULT_REU_MULT.absent)},
  };
}

async function recomputeGlobalStandings(poolId){
  const poolRef=db.doc(`pools/${poolId}`),standingsRef=poolRef.collection('standings').doc('current');
  const [poolSnapshot,playersSnapshot,previousSnapshot,previousRowsSnapshot]=await Promise.all([
    poolRef.get(),poolRef.collection('trustedPlayers').get(),standingsRef.get(),poolRef.collection('standingsRows').get(),
  ]);
  if(!poolSnapshot.exists||poolSnapshot.data().global!==true)return null;
  const pool=poolSnapshot.data(),seasonId=String(pool.globalSeasonId||pool.season?.id||'');
  const seasonSnapshot=await db.doc(`seasons/${seasonId}`).get();
  if(!seasonSnapshot.exists)throw new Error(`Published season ${seasonId} is unavailable for Global scoring.`);
  const cfg=publishedSeasonConfig(seasonSnapshot.data(),seasonId);
  const trusted=Object.fromEntries(playersSnapshot.docs.map(document=>[document.id,document.data()]));
  const previousRows={
    ...Object.fromEntries((previousSnapshot.data()?.rows||[]).map(row=>[row.uid,row])),
    ...Object.fromEntries(previousRowsSnapshot.docs.map(document=>[document.id,document.data()])),
  };
  const recalculated={},phaseScores={},phasePoolSizes={},completedByPhase={},ownerCounts={},activeCounts={};
  PHASES.forEach(phase=>{recalculated[phase]={};phaseScores[phase]={};phasePoolSizes[phase]={};completedByPhase[phase]=[];ownerCounts[phase]={};activeCounts[phase]=0;});
  for(const phase of PHASES){
    // Do not freeze a provisional zero. The first published score for a phase
    // is created only after its result set is explicitly marked ready.
    if(cfg.RESULTS_READY[phase]!==true)continue;
    const completed=Object.keys(trusted).filter(uid=>Number.isFinite(Number(trusted[uid]?.completedAt?.[phase])));
    completedByPhase[phase]=completed;
    const picksBy=Object.fromEntries(completed.map(uid=>[uid,trusted[uid]?.picks?.[phase]||[]]));
    const activeCount=Math.max(completed.filter(uid=>(picksBy[uid]||[]).length>0).length,1);
    const engine=makeEngine(cfg,activeCount);
    activeCounts[phase]=activeCount;
    completed.forEach(uid=>{
      const identities=new Set(engine.sanitizePhasePicks(phase,picksBy[uid]).map(pick=>engine.pickIdentity(phase,pick)));
      identities.forEach(identity=>{ownerCounts[phase][identity]=(ownerCounts[phase][identity]||0)+1;});
    });
    const scored=engine.scorePhase(phase,picksBy);
    completed.forEach(uid=>{
      recalculated[phase][uid]=Number(scored.totals[uid])||0;
      const priorSize=previousRows[uid]?.phasePoolSizes?.[phase];
      phasePoolSizes[phase][uid]=Number.isFinite(Number(priorSize))?Number(priorSize):activeCount;
    });
  }
  const picksByPhase=Object.fromEntries(PHASES.map(phase=>[
    phase,
    Object.fromEntries(Object.keys(trusted)
      .filter(uid=>Number.isFinite(Number(trusted[uid]?.completedAt?.[phase])))
      .map(uid=>[uid,trusted[uid]?.picks?.[phase]||[]])),
  ]));
  const revealedPhaseSet=new Set(PHASES.filter(phase=>cfg.RESULTS_READY[phase]===true));
  const retro=makeEngine(cfg,1).scoreRetroAdjustments(picksByPhase,revealedPhaseSet);
  retro.entries.filter(entry=>!entry.pending&&completedByPhase[entry.retroPhase]?.includes(entry.member)).forEach(entry=>{
    recalculated[entry.retroPhase][entry.member]=(Number(recalculated[entry.retroPhase][entry.member])||0)+(Number(entry.points)||0);
  });
  PHASES.forEach(phase=>completedByPhase[phase].forEach(uid=>{
    phaseScores[phase][uid]=freezeScoredTotal(previousRows[uid]?.phaseScores?.[phase],recalculated[phase][uid]);
  }));
  const allRows=Object.keys(trusted).map(uid=>{
    const previous=previousRows[uid]||{},scores={},sizes={},completedPhases=[];
    PHASES.forEach(phase=>{
      if(Object.prototype.hasOwnProperty.call(phaseScores[phase],uid)){
        scores[phase]=phaseScores[phase][uid];sizes[phase]=phasePoolSizes[phase][uid];completedPhases.push(phase);
      }
    });
    return {uid,username:safeHeaderText(trusted[uid].username||previous.username||'Player',40)||'Player',total:Object.values(scores).reduce((sum,value)=>sum+(Number(value)||0),0),phaseScores:scores,phasePoolSizes:sizes,completedPhases};
  }).filter(row=>row.completedPhases.length).sort((a,b)=>b.total-a.total||a.username.localeCompare(b.username)||a.uid.localeCompare(b.uid));
  let lastScore=null,rank=0;
  allRows.forEach((row,index)=>{if(row.total!==lastScore)rank=index+1;row.rank=rank;lastScore=row.total;});
  const sourceRevision=Math.max(Date.now(),...Object.values(trusted).map(player=>Number(player.updatedAt)||0));
  for(let offset=0;offset<allRows.length;offset+=400){
    const batch=db.batch();
    allRows.slice(offset,offset+400).forEach(row=>batch.set(
      poolRef.collection('standingsRows').doc(row.uid),
      {...row,seasonId,sourceRevision,updatedAt:FieldValue.serverTimestamp()},
    ));
    await batch.commit();
  }
  const bounded=boundedGlobalStandingsRows(allRows);
  const document={
    schemaVersion:GLOBAL_SCORING_VERSION,engineVersion:GLOBAL_SCORING_VERSION,seasonId,sourceRevision,
    computedAt:Date.now(),...bounded,ownerCounts,activeCounts,
  };
  const byteSize=Buffer.byteLength(JSON.stringify(document));
  if(byteSize>STANDINGS_DOCUMENT_SOFT_LIMIT)throw new Error(`Global standings document is ${byteSize} bytes; refusing to approach Firestore's document limit.`);
  await db.runTransaction(async transaction=>{
    const current=await transaction.get(standingsRef);
    if((Number(current.data()?.sourceRevision)||0)>sourceRevision)return;
    transaction.set(standingsRef,{...document,updatedAt:FieldValue.serverTimestamp()});
  });
  return document;
}

async function requestGlobalStandingsRebuild(poolId,reason){
  try{
    await db.doc(`pools/${poolId}/standings/rebuild`).set({
      requestedAt:new Date(),requestVersion:FieldValue.increment(1),reason:safeHeaderText(reason,80),
    },{merge:true});
    return true;
  }catch(error){
    console.error('Global standings rebuild could not be queued.',{poolId,reason,error});
    return false;
  }
}

async function claimGlobalStandingsRebuild(markerRef,nowMs=Date.now(),firestore=db){
  return firestore.runTransaction(async transaction=>{
    const marker=await transaction.get(markerRef);
    if(!marker.exists)return {claimed:false,pending:false,waitMs:0};
    const data=marker.data()||{};
    const lastRunAt=firestoreMillis(data.lastRunAt);
    const requestedAt=firestoreMillis(data.requestedAt);
    const requestVersion=Math.max(0,Number(data.requestVersion)||0);
    const handledRequestVersion=Math.max(0,Number(data.handledRequestVersion)||0);
    const pending=data.dirty===true||requestVersion>handledRequestVersion||(!requestVersion&&requestedAt>lastRunAt);
    if(!pending)return {claimed:false,pending:false,waitMs:0};
    if(lastRunAt&&nowMs-lastRunAt<STANDINGS_REBUILD_COOLDOWN_MS){
      if(data.dirty!==true)transaction.set(markerRef,{dirty:true},{merge:true});
      return {claimed:false,pending:true,waitMs:STANDINGS_REBUILD_COOLDOWN_MS-(nowMs-lastRunAt)};
    }
    transaction.set(markerRef,{
      lastRunAt:new Date(nowMs),handledRequestVersion:requestVersion,dirty:false,
    },{merge:true});
    return {claimed:true,pending:false,waitMs:0};
  });
}

async function waitForGlobalStandingsClaim(markerRef){
  let claim=await claimGlobalStandingsRebuild(markerRef);
  if(!claim.claimed&&claim.pending&&claim.waitMs>0){
    await new Promise(resolve=>setTimeout(resolve,claim.waitMs+25));
    claim=await claimGlobalStandingsRebuild(markerRef);
  }
  return claim;
}

async function recordGlobalStandingsFailure(markerRef,error){
  const failures=(Number((await markerRef.get()).data()?.failureCount)||0)+1;
  await markerRef.set({
    dirty:failures<3,failureCount:failures,lastErrorAt:new Date(),
    lastError:safeHeaderText(error?.message||error,500),
  },{merge:true}).catch(()=>{});
  return failures;
}

exports.rebuildGlobalStandings=onDocumentWritten({
  ...FUNCTION_LIMITS,timeoutSeconds:300,memory:'512MiB',document:'pools/{poolId}/standings/rebuild',
},async event=>{
  if(!event.data?.after.exists)return;
  const markerRef=event.data.after.ref;
  try{
    let claim=await waitForGlobalStandingsClaim(markerRef),passes=0;
    while(claim.claimed&&passes<5){
      const standings=await recomputeGlobalStandings(event.params.poolId);
      await markerRef.set({
        lastCompletedAt:new Date(),lastSourceRevision:Number(standings?.sourceRevision)||0,
        failureCount:0,lastError:FieldValue.delete(),
      },{merge:true});
      passes++;
      claim=await waitForGlobalStandingsClaim(markerRef);
    }
  }catch(error){
    await recordGlobalStandingsFailure(markerRef,error);
    throw error;
  }
});

function cleanRatings(value){
  return (Array.isArray(value)?value:[]).slice(0,80).map(entry=>{
    const values={};
    RATING_CATEGORIES.forEach(category=>{
      const score=Number(entry?.values?.[category]);
      if(Number.isInteger(score)&&score>=0&&score<=10)values[category]=score;
    });
    const flag=['red','green'].includes(entry?.flag)?entry.flag:'';
    return {name:String(entry?.name||'').trim().slice(0,80),gender:['M','F'].includes(entry?.gender)?entry.gender:'',values,flag};
  }).filter(entry=>entry.name&&(Object.keys(entry.values).length||entry.flag));
}

function ratingMetrics(entry){
  const metrics={};
  RATING_CATEGORIES.forEach(category=>{
    const value=Number(entry?.values?.[category]);
    if(Number.isInteger(value)&&value>=0&&value<=10)metrics[category]=value;
  });
  if(RATING_CATEGORIES.every(category=>Number.isInteger(metrics[category])))metrics.overall=RATING_CATEGORIES.reduce((sum,category)=>sum+metrics[category],0);
  if(entry?.flag==='red')metrics.redFlag=1;
  if(entry?.flag==='green')metrics.greenFlag=1;
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

exports.sendPhaseLockNudges=onDocumentWritten({...MAIL_FUNCTION_LIMITS,document:'pools/{poolId}/phaseStatus/{phase}'},async event=>{
  const after=event.data?.after.exists?event.data.after.data():null;
  if(!after)return;
  const beforeMembers=new Set(event.data?.before.exists?(event.data.before.data().completedMembers||[]):[]);
  const newlyLocked=(after.completedMembers||[]).filter(uid=>!beforeMembers.has(uid));
  if(!newlyLocked.length)return;
  const poolSnapshot=await db.doc(`pools/${event.params.poolId}`).get();
  if(!poolSnapshot.exists||poolSnapshot.data().global===true)return;
  const pool=poolSnapshot.data(),phase=event.params.phase;
  const phaseLabel={pods:'Pods',dating:'Retreats',weddings:'Weddings',reunion:'Reunion'}[phase]||phase;
  const completedPool=phase==='reunion';
  for(const lockerUid of newlyLocked){
    const profile=await db.doc(`users/${lockerUid}`).get();
    const lockerName=stripLinkText(profile.data()?.username,'A friend',40);
    const poolName=stripLinkText(pool.name,'your Through the Wall pool',100);
    const preferenceKey=completedPool?'friendPoolCompletions':'friendPhaseLocks';
    const candidates=(Array.isArray(pool.members)?pool.members:[]).filter(uid=>uid!==lockerUid);
    const preferences=await Promise.all(candidates.map(uid=>db.doc(`notificationPreferences/${uid}`).get()));
    const recipients=candidates.filter((uid,index)=>preferences[index].exists&&nudgePreferenceEnabled(preferences[index].data(),preferenceKey));
    const granted=await reserveMailBudget(recipients.length);
    if(granted<recipients.length)console.warn(`Daily mail ceiling skipped ${recipients.length-granted} phase-lock nudge email(s).`);
    const approved=recipients.slice(0,granted);
    if(!approved.length)continue;
    const users=await getAuth().getUsers(approved.map(uid=>({uid})));
    await Promise.all(users.users.map(user=>queueNudgeForUser(
      user,
      `${completedPool?'complete':'phase'}_${event.params.poolId}_${phase}_${lockerUid}_${user.uid}`,
      completedPool?`${lockerName} completed ${poolName}`:`${lockerName} locked their ${phaseLabel} picks`,
      completedPool?`${lockerName} made it through every phase in ${poolName}. See how the final standings look.`:`${lockerName} just locked their ${phaseLabel} picks in ${poolName}. The tea is moving.`,
      preferenceKey,
    )));
  }
});

exports.sendNewEpisodeNudges=onDocumentWritten({...MAIL_FUNCTION_LIMITS,timeoutSeconds:540,document:'seasons/{seasonId}'},async event=>{
  if(!event.data?.after.exists)return;
  const before=event.data?.before.exists?event.data.before.data():{};
  const after=event.data.after.data();
  const beforeEpisode=Number(publishedSetting(before,'AVAILABLE_THROUGH_EP'))||0;
  const afterEpisode=Number(publishedSetting(after,'AVAILABLE_THROUGH_EP'))||0;
  const normalizeStatus=value=>String(value||'').trim().toLowerCase().replace(/[^a-z]/g,'');
  const liveStatuses=new Set(['live','active','started','airing']);
  const beforeStatus=normalizeStatus(publishedSetting(before,'SEASON_STATUS')||before.status);
  const afterStatus=normalizeStatus(publishedSetting(after,'SEASON_STATUS')||after.status);
  const seasonBecameLive=liveStatuses.has(afterStatus)&&!liveStatuses.has(beforeStatus);
  let seasonNotified=new Set();
  if(seasonBecameLive){
    const recipients=await enabledNotificationRecipients('newSeasons');
    const seasonLabel=String(after.label||after.seasonLabel||publishedSetting(after,'SEASON_LABEL')||publishedSetting(after,'TITLE')||'A new Love Is Blind season');
    seasonNotified=await queueNudgeChunks(recipients,uid=>({
      id:`season_${event.params.seasonId}_${uid}`,
      subject:`${seasonLabel} just dropped`,
      text:`${seasonLabel} is open for predictions. Build your pool before the group chat starts calling it.`,
      preferenceKey:'newSeasons',
    }));
  }
  if(afterEpisode<=beforeEpisode)return;
  const pools=await db.collection('pools').where('season.id','==',event.params.seasonId).get();
  const members=new Set();pools.docs.forEach(pool=>{(pool.data().members||[]).forEach(uid=>members.add(uid));});
  const optedIn=await enabledNotificationRecipients('newEpisodes');
  const recipients=optedIn.filter(uid=>members.has(uid)&&!seasonNotified.has(uid));
  await queueNudgeChunks(recipients,uid=>({
    id:`episodes_${event.params.seasonId}_${afterEpisode}_${uid}`,
    subject:'New episodes are out — your picks are waiting',
    text:`New episodes are out through Episode ${afterEpisode}. Your picks are waiting before you watch.`,
    preferenceKey:'newEpisodes',
  }));
});

async function removeMemberData(poolRef,uid){
  const batch=db.batch();
  batch.delete(poolRef.collection('players').doc(uid));
  batch.delete(poolRef.collection('trustedPlayers').doc(uid));
  batch.delete(poolRef.collection('standingsRows').doc(uid));
  batch.delete(poolRef.collection('castRatings').doc(uid));
  PHASES.forEach(phase=>{
    batch.delete(poolRef.collection('phasePicks').doc(`${phase}__${uid}`));
    batch.set(poolRef.collection('phaseStatus').doc(phase),{completedMembers:FieldValue.arrayRemove(uid),updatedAt:Date.now()},{merge:true});
  });
  await batch.commit();
}

exports.leavePool=onCall(CALLABLE_LIMITS,async request=>{
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
  if(pool.global===true)await requestGlobalStandingsRebuild(poolId,'member-left');
  return {ok:true};
});

exports.deletePool=onCall(CALLABLE_LIMITS,async request=>{
  const uid=requireUser(request);
  const poolId=String(request.data?.poolId||'');
  if(!poolId)throw new HttpsError('invalid-argument','Choose a pool to delete.');
  const poolRef=db.doc(`pools/${poolId}`);
  const snapshot=await poolRef.get();
  if(!snapshot.exists)throw new HttpsError('not-found','This pool no longer exists.');
  const pool=snapshot.data();
  if(pool.global===true)throw new HttpsError('failed-precondition','The Global Pool cannot be deleted here.');
  if(pool.ownerUid!==uid)throw new HttpsError('permission-denied','Only the pool owner can delete this pool.');
  const invitations=await db.collection('invites').where('poolId','==',poolId).get();
  for(let offset=0;offset<invitations.docs.length;offset+=400){
    const batch=db.batch();
    invitations.docs.slice(offset,offset+400).forEach(invitation=>batch.delete(invitation.ref));
    await batch.commit();
  }
  await db.recursiveDelete(poolRef);
  return {ok:true};
});

exports.reopenPhase=onCall(CALLABLE_LIMITS,async request=>{
  const uid=requireUser(request);
  const poolId=String(request.data?.poolId||'');
  const phase=String(request.data?.phase||'');
  if(!poolId||!PHASES.includes(phase))throw new HttpsError('invalid-argument','Choose a valid phase to reopen.');
  const poolRef=db.doc(`pools/${poolId}`);
  const statusRef=poolRef.collection('phaseStatus').doc(phase);
  const trustedRef=poolRef.collection('trustedPlayers').doc(uid);
  let globalPool=false;
  await db.runTransaction(async tx=>{
    const poolSnapshot=await tx.get(poolRef);
    if(!poolSnapshot.exists)throw new HttpsError('not-found','This pool no longer exists.');
    const pool=poolSnapshot.data();
    if(!Array.isArray(pool.members)||!pool.members.includes(uid))throw new HttpsError('permission-denied','You are not a member of this pool.');
    const seasonId=String(pool.season?.id||pool.seasonId||pool.globalSeasonId||'');
    if(!seasonId)throw new HttpsError('failed-precondition','This pool has no season configured.');
    globalPool=pool.global===true;
    const [seasonSnapshot,statusSnapshot,trustedSnapshot]=await Promise.all([
      tx.get(db.doc(`seasons/${seasonId}`)),
      tx.get(statusRef),
      globalPool?tx.get(trustedRef):Promise.resolve(null),
    ]);
    if(!seasonSnapshot.exists)throw new HttpsError('failed-precondition','The published season snapshot is unavailable.');
    if(!statusSnapshot.exists||!(statusSnapshot.data().completedMembers||[]).includes(uid))throw new HttpsError('failed-precondition','This phase is not locked for you.');
    const season=seasonSnapshot.data();
    const seasonStatus=String(publishedSetting(season,'SEASON_STATUS')||season.status||'').trim().toLowerCase().replace(/[^a-z]/g,'');
    if(!['live','active','started','airing'].includes(seasonStatus))throw new HttpsError('failed-precondition','Only a live season phase can reopen.');
    const boundaryKey=`${phase.toUpperCase()}_BOUNDARY_FINAL`;
    if(publishedBool(publishedSetting(season,boundaryKey),false))throw new HttpsError('failed-precondition','This phase boundary is final and cannot reopen.');
    tx.update(statusRef,{completedMembers:FieldValue.arrayRemove(uid),updatedAt:Date.now()});
    if(globalPool&&trustedSnapshot?.exists)tx.update(trustedRef,{[`completedAt.${phase}`]:FieldValue.delete(),updatedAt:Date.now()});
  });
  if(globalPool)await requestGlobalStandingsRebuild(poolId,'phase-reopened');
  return {ok:true};
});

const DAILY_EMAIL_INVITE_LIMIT=20;
const DAILY_FEEDBACK_LIMIT=5;
const FEEDBACK_CATEGORIES={feedback:'Feedback or idea',bug:'Something is broken',help:'Help request'};

async function submitFeedback(request){
  const uid=requireUser(request);
  const category=String(request.data?.category||'').trim().toLowerCase();
  const message=String(request.data?.message||'').trim();
  const submissionId=String(request.data?.submissionId||'').trim().toLowerCase();
  if(!Object.prototype.hasOwnProperty.call(FEEDBACK_CATEGORIES,category))throw new HttpsError('invalid-argument','Choose feedback, a bug report, or a help request.');
  if(message.length<10||message.length>2000)throw new HttpsError('invalid-argument','Write a message between 10 and 2,000 characters.');
  if(!/^[a-z0-9-]{12,80}$/.test(submissionId))throw new HttpsError('invalid-argument','This support request is missing a valid submission identifier.');
  const context=request.data?.context&&typeof request.data.context==='object'&&!Array.isArray(request.data.context)?request.data.context:{};
  const safeContext={
    screen:safeHeaderText(context.screen,80),
    poolId:safeHeaderText(context.poolId,100),
    seasonId:safeHeaderText(context.seasonId,100),
  };
  const [authUser,profileSnapshot]=await Promise.all([
    getAuth().getUser(uid),
    db.doc(`users/${uid}`).get(),
  ]);
  const email=String(authUser.email||'').trim().toLowerCase();
  const username=safeHeaderText(profileSnapshot.data()?.username||'Player',40)||'Player';
  const createdAt=Date.now();
  const day=new Date(createdAt).toISOString().slice(0,10);
  const limitRef=db.doc(`feedbackRateLimits/${uid}__${day}`);
  const mailRef=db.doc(`mail/feedback_${uid}_${submissionId}`);
  const dailyRef=mailCounterRef(createdAt);
  let remaining=0,alreadySubmitted=false;
  await db.runTransaction(async tx=>{
    const [limitSnapshot,mailSnapshot,dailySnapshot]=await Promise.all([tx.get(limitRef),tx.get(mailRef),tx.get(dailyRef)]);
    if(mailSnapshot.exists){alreadySubmitted=true;remaining=Math.max(0,DAILY_FEEDBACK_LIMIT-(Number(limitSnapshot.data()?.count)||0));return;}
    const count=Number(limitSnapshot.data()?.count)||0;
    if(count>=DAILY_FEEDBACK_LIMIT)throw new HttpsError('resource-exhausted','You have reached today’s support-message limit. Email support@throughthewall.ca if this is urgent.');
    const label=FEEDBACK_CATEGORIES[category];
    const contextLines=Object.entries(safeContext).filter(([,value])=>value).map(([key,value])=>`${key}: ${value}`);
    const text=[
      `${label} from ${username}`,
      `Account email: ${email||'Unavailable'}`,
      ...contextLines,
      '',
      message,
    ].join('\n');
    const contextHtml=contextLines.map(line=>`<li>${escapeHtml(line)}</li>`).join('');
    tx.set(limitRef,{uid,day,count:count+1,updatedAt:createdAt},{merge:true});
    tx.set(dailyRef,{count:(Number(dailySnapshot.data()?.count)||0)+1,invites:Number(dailySnapshot.data()?.invites)||0,updatedAt:createdAt},{merge:true});
    tx.create(mailRef,{
      to:[MAIL_REPLY_TO],feedbackUserId:uid,feedbackCategory:category,createdAt,
      from:MAIL_SENDERS.support,
      replyTo:email||MAIL_REPLY_TO,
      message:{
        subject:`[Through the Wall] ${label} from ${username}`,
        text,
        html:`<p><b>${escapeHtml(label)} from ${escapeHtml(username)}</b></p><p>Account email: ${escapeHtml(email||'Unavailable')}</p>${contextHtml?`<ul>${contextHtml}</ul>`:''}<hr><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
      },
    });
    remaining=DAILY_FEEDBACK_LIMIT-count-1;
  });
  return {ok:true,alreadySubmitted,limit:DAILY_FEEDBACK_LIMIT,remaining};
}

const alreadyExistsError=error=>['6','already-exists','already_exists'].includes(String(error?.code??'').toLowerCase());

async function emailPreferences(request){
  const token=String(request.data?.token||''),payload=verifyEmailPreferenceToken(token,EMAIL_PREFERENCES_SECRET.value());
  if(!payload)throw new HttpsError('invalid-argument',"This unsubscribe link isn't valid. Email support@throughthewall.ca and we'll take care of it.");
  const kind=payload.t==='invite'?'invite':'nudge';
  const preferenceLabel=kind==='invite'?'Through the Wall invitations':PREFERENCE_LABELS[payload.p];
  if(request.data?.apply!==true)return {kind,preferenceLabel};
  if(kind==='invite'){
    await db.doc(`emailSuppressions/${payload.e}`).set({invites:true,createdAt:Date.now()},{merge:true});
  }else{
    const ref=db.doc(`notificationPreferences/${payload.u}`),all=request.data?.all===true;
    await db.runTransaction(async tx=>{
      const snapshot=await tx.get(ref),current=snapshot.exists?snapshot.data():{};
      const normalized=Object.fromEntries(Object.keys(PREFERENCE_LABELS).map(key=>[key,nudgePreferenceEnabled(current,key)]));
      if(all)Object.keys(normalized).forEach(key=>{normalized[key]=false;});
      else normalized[payload.p]=false;
      tx.set(ref,{...normalized,updatedAt:Date.now()});
    });
  }
  return {kind,applied:true};
}

async function captainReminder(request){
  requireUser(request);
  if(!isGlobalPoolAdmin(request))throw new HttpsError('permission-denied','Only the app administrator can send captain reminders.');
  const seasonId=String(request.data?.seasonId||'').trim();
  const dropTimeText=safeHeaderText(request.data?.dropTimeText||'3 a.m. ET / 1 a.m. MT',100);
  if(!seasonId)throw new HttpsError('invalid-argument','Choose a season.');
  const poolsSnapshot=await db.collection('pools').where('season.id','==',seasonId).get();
  const groups=new Map();
  poolsSnapshot.docs.forEach(document=>{
    const pool=document.data(),members=Array.isArray(pool.members)?pool.members:[];
    if(pool.global===true||pool.membershipClosed===true||members.length>=4||!pool.ownerUid)return;
    groups.set(pool.ownerUid,[...(groups.get(pool.ownerUid)||[]),{id:document.id,...pool,members}]);
  });
  const owners=[];
  for(const [uid,pools] of groups){
    const preference=await db.doc(`notificationPreferences/${uid}`).get();
    if(preference.data()?.newSeasons===true)owners.push({uid,pools});
  }
  const poolCount=owners.reduce((sum,owner)=>sum+owner.pools.length,0);
  if(request.data?.dryRun===true)return {owners:owners.length,pools:poolCount};
  const granted=await reserveMailBudget(owners.length),approved=owners.slice(0,granted);
  if(granted<owners.length)console.warn(`Daily mail ceiling skipped ${owners.length-granted} captain reminder email(s).`);
  const authResult=approved.length?await getAuth().getUsers(approved.map(owner=>({uid:owner.uid}))):{users:[]};
  const users=new Map(authResult.users.map(user=>[user.uid,user]));
  let queued=0,skipped=owners.length-approved.length;
  for(const owner of approved){
    const user=users.get(owner.uid);
    if(!user?.email){skipped++;continue;}
    const seasonLabel=stripLinkText(owner.pools[0]?.season?.label,'Love Is Blind',100);
    const paragraphs=owner.pools.map(pool=>{
      const poolName=stripLinkText(pool.name,'your Through the Wall pool',100);
      const inviteUrl=pool.joinCode?`${APP_URL}?join=${encodeURIComponent(pool.id)}.${encodeURIComponent(pool.joinCode)}`:APP_URL;
      return `Your pool ${poolName} has ${pool.members.length} player(s). ${seasonLabel} drops at ${dropTimeText}. Send your friends the invite link: ${inviteUrl}`;
    });
    const body=[...paragraphs,'Watch Episode 1, then make your picks before Episode 2.'].join('\n\n');
    const token=signEmailPreferenceToken({v:1,t:'nudge',u:owner.uid,p:'newSeasons'},EMAIL_PREFERENCES_SECRET.value());
    const footer=buildEmailFooter({kind:'nudge',preferenceLabel:PREFERENCE_LABELS.newSeasons,postalAddress:MAIL_POSTAL_ADDRESS.value(),preferencesUrl:emailPreferencesUrl(token)});
    try{
      await db.doc(`mail/captain_${seasonId}_${owner.uid}`).create({
        to:[user.email],from:MAIL_SENDERS.updates,replyTo:MAIL_REPLY_TO,headers:mailUnsubscribeHeaders(token),
        message:{subject:`${seasonLabel} starts tonight. Bring your group chat.`,text:`${body}\n\n${footer.text}`,html:body.split('\n\n').map(text=>`<p>${escapeHtml(text)}</p>`).join('')+footer.html},
      });
      queued++;
    }catch(error){if(alreadyExistsError(error))skipped++;else throw error;}
  }
  return {queued,skipped};
}

exports.sendPoolInvite=onCall(MAIL_CALLABLE_LIMITS,async request=>{
  if(request.data?.action==='feedback')return submitFeedback(request);
  if(request.data?.action==='emailPreferences')return emailPreferences(request);
  if(request.data?.action==='captainReminder')return captainReminder(request);
  const uid=requireUser(request),poolId=String(request.data?.poolId||'');
  const toEmail=String(request.data?.toEmail||'').trim().toLowerCase();
  if(!poolId||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail))throw new HttpsError('invalid-argument','Enter a valid email address.');
  const createdAt=Date.now(),day=utcDay(createdAt),poolRef=db.doc(`pools/${poolId}`);
  const inviteRef=db.doc(`invites/${poolId}__${toEmail}`),mailRef=db.doc(`mail/invite_${poolId}__${encodeURIComponent(toEmail)}`);
  const limitRef=db.doc(`inviteRateLimits/${uid}__${day}`),dailyRef=mailCounterRef(createdAt);
  const suppressionRef=db.doc(`emailSuppressions/${emailHash(toEmail)}`),profileSnap=await db.doc(`users/${uid}`).get();
  let invitationCount=0;
  await db.runTransaction(async tx=>{
    const [poolSnap,existing,mailSnap,suppression,limitSnap,dailySnap]=await Promise.all([
      tx.get(poolRef),tx.get(inviteRef),tx.get(mailRef),tx.get(suppressionRef),tx.get(limitRef),tx.get(dailyRef),
    ]);
    if(!poolSnap.exists||poolSnap.data().ownerUid!==uid)throw new HttpsError('permission-denied','Only the pool owner can email invitations.');
    const pool=poolSnap.data(),members=Array.isArray(pool.members)?pool.members:[];
    if(pool.membershipClosed===true)throw new HttpsError('failed-precondition','This pool is locked for new players.');
    if(members.length>=FRIEND_POOL_MEMBER_LIMIT)throw new HttpsError('failed-precondition','This pool is full. Friends can play in the Global Pool instead.');
    if(existing.exists){
      if(existing.data().status==='pending')throw new HttpsError('already-exists',`You've already invited ${toEmail}. If they can't find it, share the pool link instead.`);
      throw new HttpsError('already-exists','That invitation was already answered. Share the pool link instead.');
    }
    if(mailSnap.exists)throw new HttpsError('already-exists',`You've already invited ${toEmail}. If they can't find it, share the pool link instead.`);
    if(suppression.data()?.invites===true)throw new HttpsError('failed-precondition',"We can't email an invitation to this address. Share the pool link instead.");
    const count=Number(limitSnap.data()?.count)||0,dailyCount=Number(dailySnap.data()?.count)||0,dailyInvites=Number(dailySnap.data()?.invites)||0;
    if(count>=DAILY_EMAIL_INVITE_LIMIT)throw new HttpsError('resource-exhausted','You have reached today’s invitation limit. Share the pool link instead.');
    if(dailyInvites>=INVITE_PROJECT_DAILY_LIMIT||dailyCount>=MAIL_PROJECT_DAILY_LIMIT)throw new HttpsError('resource-exhausted','Email invitations are paused for today. Share the pool link instead.');
    const inviterName=stripLinkText(profileSnap.data()?.username,'A friend',40);
    const poolNameForEmail=stripLinkText(pool.name,'a Through the Wall pool',100);
    const seasonLabel=stripLinkText(pool.season?.label,'Love Is Blind',100);
    const inviteUrl=new URL(APP_URL);inviteUrl.searchParams.set('join',poolId+'.'+String(pool.joinCode||''));
    const token=signEmailPreferenceToken({v:1,t:'invite',e:emailHash(toEmail)},EMAIL_PREFERENCES_SECRET.value());
    const footer=buildEmailFooter({kind:'invite',inviterName,postalAddress:MAIL_POSTAL_ADDRESS.value(),preferencesUrl:emailPreferencesUrl(token)});
    const subject=`${inviterName} invited you to ${poolNameForEmail}`;
    const text=`${inviterName} invited you to join their Through the Wall prediction pool, “${poolNameForEmail},” for ${seasonLabel}.\n\nJoin the pool: ${inviteUrl}\n\n${footer.text}`;
    const logoUrlWithVersion=new URL('images/through-the-wall-app-icon.png?v=2',APP_URL).href;
    const html=`<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f7f4ff;font-family:Arial,Helvetica,sans-serif;color:#211a37;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(inviterName)} wants you in their unofficial Love Is Blind prediction pool. Your pod is waiting.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;padding:28px 12px;background:#f7f4ff;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(52,31,98,.13);">
          <tr><td style="padding:28px 32px;background:linear-gradient(135deg,#351263 0%,#7b2cbf 55%,#ef5da8 100%);color:#ffffff;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
              <td width="50" valign="middle"><img src="${escapeHtml(logoUrlWithVersion)}" width="42" height="42" alt="Through the Wall" style="display:block;width:42px;height:42px;border:0;"></td>
              <td valign="middle" style="padding-left:11px;"><div style="font-size:13px;font-weight:700;letter-spacing:1.7px;text-transform:uppercase;opacity:.9;">Through the Wall</div><div style="margin-top:5px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;opacity:.78;">An unofficial Love Is Blind prediction pool</div></td>
            </tr></table>
            <div style="margin-top:14px;font-size:32px;line-height:1.12;font-weight:800;">You’re in the pods. 💜</div>
            <div style="margin-top:10px;font-size:16px;line-height:1.5;color:#f6ecff;">${escapeHtml(inviterName)} is building their pod squad. You’re on the list.</div>
          </td></tr>
          <tr><td style="padding:32px;">
            <p style="margin:0 0 22px;font-size:17px;line-height:1.55;">Make your predictions, lock them in, and earn your group-chat bragging rights.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 26px;background:#f7f1ff;border:1px solid #eadcff;border-radius:16px;">
              <tr><td style="padding:18px 20px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#7b2cbf;">Your pool</div>
                <div style="margin-top:6px;font-size:21px;line-height:1.25;font-weight:800;color:#211a37;">${escapeHtml(poolNameForEmail)}</div>
                <div style="margin-top:7px;font-size:14px;line-height:1.4;color:#625675;">${escapeHtml(seasonLabel)}</div>
              </td></tr>
            </table>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr><td align="center" style="border-radius:999px;background:#e94e9b;">
                <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;padding:15px 28px;border-radius:999px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;">Join the pool →</a>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0;">${footer.html}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
    tx.create(inviteRef,{poolId,poolName:poolNameForEmail,seasonLabel,fromUid:uid,fromUsername:inviterName,toEmail,status:'pending',createdAt});
    tx.set(limitRef,{uid,day,count:count+1,updatedAt:createdAt},{merge:true});
    tx.set(dailyRef,{count:dailyCount+1,invites:dailyInvites+1,updatedAt:createdAt},{merge:true});
    tx.create(mailRef,{to:[toEmail],from:MAIL_SENDERS.invites,replyTo:MAIL_REPLY_TO,headers:mailUnsubscribeHeaders(token),message:{subject,text,html}});
    invitationCount=count+1;
  });
  return {ok:true,limit:DAILY_EMAIL_INVITE_LIMIT,remaining:Math.max(0,DAILY_EMAIL_INVITE_LIMIT-invitationCount)};
});

exports.openGlobalPool=onCall(CALLABLE_LIMITS,async request=>{
  const action=String(request.data?.action||'open');
  if(action==='lockGlobalPicks')return lockGlobalPicks(request);
  if(action==='completeGlobalPhase')return completeGlobalPhase(request);
  if(action==='advanceGlobalWatch')return advanceGlobalWatch(request);
  if(action==='resetHistoricalSimulation')return resetHistoricalGlobalSimulation(request);
  if(action==='relaxHistoricalJoinFloor')return relaxHistoricalJoinFloor(request);
  if(action!=='open')throw new HttpsError('invalid-argument','Choose a valid Global Pool action.');
  const uid=requireUser(request);
  const seasonId=String(request.data?.seasonId||'');
  const initialWatchedThrough=Number(request.data?.initialWatchedThrough);
  const ref=db.doc(`pools/global__${seasonId}`);
  const trustedRef=ref.collection('trustedPlayers').doc(uid);
  const configRef=db.doc('appConfig/public');
  try{await retryAborted(()=>db.runTransaction(async tx=>{
    const configSnapshot=await tx.get(configRef);
    const season=globalPoolSeasonFromConfig(configSnapshot.exists?configSnapshot.data():null);
    if(seasonId!==season.id)throw new HttpsError('invalid-argument','That season is not the active Global Pool season.');
    if(season.status==='completed')throw new HttpsError('failed-precondition','A completed season cannot open the active Global Pool.');
    const [snapshot,seasonSnapshot,trustedSnapshot]=await Promise.all([
      tx.get(ref),tx.get(db.doc(`seasons/${seasonId}`)),tx.get(trustedRef),
    ]);
    if(!seasonSnapshot.exists)throw new HttpsError('failed-precondition','The published season snapshot is unavailable.');
    const cfg=publishedSeasonConfig(seasonSnapshot.data(),seasonId);
    if(snapshot.exists){
      const current=snapshot.data();
      if(current.global!==true||current.globalSeasonId!==seasonId)throw new HttpsError('failed-precondition','The global pool document is configured incorrectly.');
      const alreadyMember=Array.isArray(current.members)&&current.members.includes(uid);
      if(!globalJoinHasCapacity(current.members,uid)){
        throw new HttpsError('resource-exhausted','The Global Pool is temporarily full while membership storage is upgraded. Please try again later.');
      }
      const update={scoringVersion:GLOBAL_SCORING_VERSION};
      if(!alreadyMember)update.members=FieldValue.arrayUnion(uid);
      tx.update(ref,update);
      const ledgerFields=globalLedgerFieldsForJoin(
        trustedSnapshot.exists?trustedSnapshot.data():{},initialWatchedThrough,cfg.AVAILABLE_THROUGH_EP,
      );
      if(!trustedSnapshot.exists)ledgerFields.uid=uid;
      if(Object.keys(ledgerFields).length)tx.set(trustedRef,ledgerFields,{merge:true});
      return;
    }
    if(!isGlobalPoolAdmin(request))throw new HttpsError('permission-denied','The app administrator needs to open this global pool first.');
    tx.create(ref,{
      name:`Global Pool · ${season.label}`,ownerUid:uid,members:[uid],global:true,globalSeasonId:seasonId,
      membershipClosed:false,season,rulesSnapshot:null,scoringVersion:GLOBAL_SCORING_VERSION,createdAt:Date.now(),
    });
    tx.set(trustedRef,{uid,...globalLedgerFieldsForJoin({},initialWatchedThrough,cfg.AVAILABLE_THROUGH_EP)});
  }),6);}catch(error){
    if(abortedFirestoreWrite(error))throw new HttpsError('unavailable','The Global Pool is busy right now. Try again in a few seconds.');
    throw error;
  }
  return {ok:true,poolId:ref.id};
});

async function advanceGlobalWatch(request){
  const uid=requireUser(request),poolId=String(request.data?.poolId||'');
  const requested=Number(request.data?.watchedThrough);
  if(!poolId||!Number.isFinite(requested))throw new HttpsError('invalid-argument','Choose a valid watch-through episode.');
  const poolRef=db.doc(`pools/${poolId}`),trustedRef=poolRef.collection('trustedPlayers').doc(uid);
  let watchedThrough=0;
  await db.runTransaction(async transaction=>{
    const poolSnapshot=await transaction.get(poolRef);
    if(!poolSnapshot.exists||poolSnapshot.data().global!==true)throw new HttpsError('failed-precondition','Trusted watch progress is available only in the Global Pool.');
    const pool=poolSnapshot.data();
    if(!Array.isArray(pool.members)||!pool.members.includes(uid))throw new HttpsError('permission-denied','Join the Global Pool before advancing watch progress.');
    const seasonId=String(pool.globalSeasonId||pool.season?.id||'');
    const [trustedSnapshot,seasonSnapshot]=await Promise.all([
      transaction.get(trustedRef),transaction.get(db.doc(`seasons/${seasonId}`)),
    ]);
    if(!trustedSnapshot.exists||!globalWatchLedgerReady(trustedSnapshot.data()))throw new HttpsError('failed-precondition','Open the Global Pool before advancing watch progress.');
    if(!seasonSnapshot.exists)throw new HttpsError('failed-precondition','The published season snapshot is unavailable.');
    const cfg=publishedSeasonConfig(seasonSnapshot.data(),seasonId);
    watchedThrough=advanceGlobalWatchValue(trustedSnapshot.data().watchedThrough,requested,cfg.AVAILABLE_THROUGH_EP);
    transaction.set(trustedRef,{watchedThrough},{merge:true});
  });
  return {ok:true,watchedThrough};
}

async function lockGlobalPicks(request){
  const uid=requireUser(request);
  const poolId=String(request.data?.poolId||'');
  const submitted=request.data?.phases;
  if(!poolId||!submitted||typeof submitted!=='object'||Array.isArray(submitted))throw new HttpsError('invalid-argument','Choose Global Pool predictions to lock.');
  const poolRef=db.doc(`pools/${poolId}`),trustedRef=poolRef.collection('trustedPlayers').doc(uid),profileRef=db.doc(`users/${uid}`);
  const [poolSnapshot,profileSnapshot]=await Promise.all([poolRef.get(),profileRef.get()]);
  if(!poolSnapshot.exists||poolSnapshot.data().global!==true)throw new HttpsError('failed-precondition','Trusted scoring is available only in the Global Pool.');
  const pool=poolSnapshot.data();
  if(!Array.isArray(pool.members)||!pool.members.includes(uid))throw new HttpsError('permission-denied','Join the Global Pool before locking predictions.');
  const seasonId=String(pool.globalSeasonId||pool.season?.id||''),seasonRef=db.doc(`seasons/${seasonId}`);
  const seasonSnapshot=await seasonRef.get();
  if(!seasonSnapshot.exists)throw new HttpsError('failed-precondition','The published season snapshot is unavailable.');
  const cfg=publishedSeasonConfig(seasonSnapshot.data(),seasonId),engine=makeEngine(cfg,1);
  let nextPicks={},lockedAt=0;
  await retryAborted(()=>db.runTransaction(async transaction=>{
    const trustedSnapshot=await transaction.get(trustedRef);
    const previous=trustedSnapshot.exists?trustedSnapshot.data():{};
    if(!globalWatchLedgerReady(previous))throw new HttpsError('failed-precondition','Open the Global Pool before locking predictions.');
    nextPicks={...(previous.picks||{})};
    lockedAt=Date.now();
    const authoritativeWindow=resolveGlobalWatchWindow(previous);
    for(const [phase,incoming] of Object.entries(submitted)){
      if(!PHASES.includes(phase)||!Array.isArray(incoming))throw new HttpsError('invalid-argument','One submitted prediction phase is malformed.');
      if(Number.isFinite(Number(previous.completedAt?.[phase])))continue;
      const serverStampedIncoming=incoming.map(raw=>raw&&typeof raw==='object'&&!Array.isArray(raw)
        ? {...raw,releasedThroughAtLock:cfg.AVAILABLE_THROUGH_EP}
        : raw);
      nextPicks[phase]=validateLockedPhasePicks({engine,phase,incoming:serverStampedIncoming,existing:nextPicks[phase],lockedAt,authoritativeWindow});
    }
    transaction.set(trustedRef,{
      uid,username:stripLinkText(profileSnapshot.data()?.username||previous.username,'Player',40),seasonId,
      scoringVersion:GLOBAL_SCORING_VERSION,picks:nextPicks,updatedAt:lockedAt,
    },{merge:true});
  }));
  const batch=db.batch();
  Object.keys(submitted).forEach(phase=>batch.set(
      poolRef.collection('phasePicks').doc(`${phase}__${uid}`),
      {uid,phase,picks:nextPicks[phase]||[],updatedAt:lockedAt,lockedAt},
      {merge:true},
  ));
  await batch.commit();
  const standingsQueued=await requestGlobalStandingsRebuild(poolId,'picks-locked');
  return {
    ok:true,lockedAt,
    accepted:Object.fromEntries(Object.keys(submitted).map(phase=>[phase,(nextPicks[phase]||[]).length])),
    credited:Object.fromEntries(Object.keys(submitted).map(phase=>[phase,nextPicks[phase]||[]])),
    standingsRevision:0,standingsStale:!standingsQueued,
  };
}

async function completeGlobalPhase(request){
  const uid=requireUser(request),poolId=String(request.data?.poolId||''),phase=String(request.data?.phase||'');
  if(!poolId||!PHASES.includes(phase))throw new HttpsError('invalid-argument','Choose a valid Global Pool phase to complete.');
  const poolRef=db.doc(`pools/${poolId}`),trustedRef=poolRef.collection('trustedPlayers').doc(uid),playerRef=poolRef.collection('players').doc(uid),statusRef=poolRef.collection('phaseStatus').doc(phase);
  const completedAt=Date.now();
  await retryAborted(()=>db.runTransaction(async transaction=>{
    const [poolSnapshot,trustedSnapshot,playerSnapshot]=await Promise.all([transaction.get(poolRef),transaction.get(trustedRef),transaction.get(playerRef)]);
    if(!poolSnapshot.exists||poolSnapshot.data().global!==true)throw new HttpsError('failed-precondition','Trusted completion is available only in the Global Pool.');
    if(!Array.isArray(poolSnapshot.data().members)||!poolSnapshot.data().members.includes(uid))throw new HttpsError('permission-denied','Join the Global Pool before completing a phase.');
    if(!trustedSnapshot.exists)throw new HttpsError('failed-precondition','Lock this phase’s predictions before completing it.');
    const trusted=trustedSnapshot.data();
    transaction.set(trustedRef,{...trusted,completedAt:{...(trusted.completedAt||{}),[phase]:Number(trusted.completedAt?.[phase])||completedAt},updatedAt:completedAt});
    transaction.set(statusRef,{completedMembers:FieldValue.arrayUnion(uid),updatedAt:completedAt},{merge:true});
    if(playerSnapshot.exists){
      const player=playerSnapshot.data(),watchedThrough=Math.max(Number(player.watchThrough)||0,Number(player.w)||0,Number(trusted.watchedThrough)||0);
      transaction.update(playerRef,{
        completed:{...(player.completed||{}),[phase]:true},w:watchedThrough,watchThrough:watchedThrough,
        ...(player.phase===phase?{screen:'close'}:{}),
      });
    }
  }));
  const standingsQueued=await requestGlobalStandingsRebuild(poolId,'phase-completed');
  return {ok:true,completedAt,standingsRevision:0,standingsStale:!standingsQueued};
}

async function resetHistoricalGlobalSimulation(request){
  const uid=requireUser(request);
  if(!isGlobalPoolAdmin(request))throw new HttpsError('permission-denied','Only the app administrator can reset a historical Global simulation.');
  const poolId=String(request.data?.poolId||'');
  if(!poolId)throw new HttpsError('invalid-argument','Choose a Global Pool to reset.');
  const poolRef=db.doc(`pools/${poolId}`),poolSnapshot=await poolRef.get();
  if(!poolSnapshot.exists||poolSnapshot.data().global!==true)throw new HttpsError('failed-precondition','Historical simulation reset is available only for the Global Pool.');
  const pool=poolSnapshot.data();
  if(!Array.isArray(pool.members)||!pool.members.includes(uid))throw new HttpsError('permission-denied','Join this Global Pool before resetting its simulation.');
  if(pool.members.length>50)throw new HttpsError('failed-precondition','This Global Pool is too large for the controlled simulation reset.');
  const seasonId=String(pool.globalSeasonId||pool.season?.id||''),seasonSnapshot=await db.doc(`seasons/${seasonId}`).get();
  if(!seasonSnapshot.exists)throw new HttpsError('failed-precondition','The published season snapshot is unavailable.');
  const cfg=publishedSeasonConfig(seasonSnapshot.data(),seasonId);
  const seasonEnd=Math.max(...PHASES.map(phase=>Number(cfg.PH_SPAN[phase]?.endEp)||0));
  if(cfg.AVAILABLE_THROUGH_EP<seasonEnd)throw new HttpsError('failed-precondition','A live or partially released season cannot use the historical simulation reset.');
  const [trustedSnapshot,playersSnapshot,phasePicksSnapshot]=await Promise.all([
    poolRef.collection('trustedPlayers').get(),poolRef.collection('players').get(),poolRef.collection('phasePicks').get(),
  ]);
  const linkedPlayers=playersSnapshot.docs.map(document=>({
    uid:document.id,sourcePoolId:String(document.data().duplicateFromPoolId||''),
  })).filter(link=>link.sourcePoolId);
  const sourcePoolIds=[...new Set(linkedPlayers.map(link=>link.sourcePoolId))];
  const [sourcePoolSnapshots,sourcePlayerSnapshots]=await Promise.all([
    Promise.all(sourcePoolIds.map(sourcePoolId=>db.doc(`pools/${sourcePoolId}`).get())),
    Promise.all(linkedPlayers.map(link=>db.doc(`pools/${link.sourcePoolId}/players/${link.uid}`).get())),
  ]);
  const sourcePools=new Map(sourcePoolSnapshots.map(snapshot=>[snapshot.id,snapshot]));
  const resettableLinks=linkedPlayers.filter((link,index)=>{
    const sourceSnapshot=sourcePools.get(link.sourcePoolId),source=sourceSnapshot?.data();
    if(!sourceSnapshot?.exists||!sourcePlayerSnapshots[index]?.exists||source?.global===true)return false;
    const sourceSeasonId=String(source.season?.id||source.seasonId||source.globalSeasonId||'');
    return sourceSeasonId===seasonId&&Array.isArray(source.members)&&source.members.includes(link.uid);
  });
  const linkedPlayersByPool=new Map();
  resettableLinks.forEach(link=>linkedPlayersByPool.set(
    link.sourcePoolId,[...(linkedPlayersByPool.get(link.sourcePoolId)||[]),link.uid],
  ));
  const writeCount=trustedSnapshot.size+playersSnapshot.size+phasePicksSnapshot.size+PHASES.length+1+
    resettableLinks.length*(PHASES.length+1)+linkedPlayersByPool.size*PHASES.length;
  if(writeCount>450)throw new HttpsError('failed-precondition','This Global Pool and its linked test players are too large for the controlled simulation reset.');
  const resetAt=Date.now(),batch=db.batch();
  trustedSnapshot.docs.forEach(document=>batch.set(document.ref,{
    joinedAtEp:0,watchedThrough:0,picks:{},completedAt:{},updatedAt:resetAt,
  },{merge:true}));
  playersSnapshot.docs.forEach(document=>batch.set(document.ref,{
    phase:'pods',screen:'intro',w:0,watchThrough:0,completed:{},
    // Preserve duplicateFromPoolId. Historical testers must keep their
    // established friend-pool links after the confirmed-watch ledger resets;
    // leaving and rejoining must not change player-relative scoring rules.
    lastPredictionAt:FieldValue.delete(),
  },{merge:true}));
  phasePicksSnapshot.docs.forEach(document=>batch.delete(document.ref));
  PHASES.forEach(phase=>batch.set(poolRef.collection('phaseStatus').doc(phase),{completedMembers:[],updatedAt:resetAt}));
  batch.delete(poolRef.collection('standings').doc('current'));
  // A preserved link would otherwise replay the linked player's old friend-pool
  // progress into Global as soon as either pool opens. Reset only that player's
  // game state on the source side; pool membership and every other player stay intact.
  resettableLinks.forEach(({uid,sourcePoolId})=>{
    const sourcePoolRef=db.doc(`pools/${sourcePoolId}`);
    batch.set(sourcePoolRef.collection('players').doc(uid),{
      phase:'pods',screen:'intro',w:0,watchThrough:0,completed:{},
      picks:FieldValue.delete(),lastPredictionAt:FieldValue.delete(),
    },{merge:true});
    PHASES.forEach(phase=>batch.delete(sourcePoolRef.collection('phasePicks').doc(`${phase}__${uid}`)));
  });
  linkedPlayersByPool.forEach((uids,sourcePoolId)=>{
    const sourcePoolRef=db.doc(`pools/${sourcePoolId}`);
    PHASES.forEach(phase=>batch.set(sourcePoolRef.collection('phaseStatus').doc(phase),{
      completedMembers:FieldValue.arrayRemove(...uids),updatedAt:resetAt,
    },{merge:true}));
  });
  await batch.commit();
  const linksPreserved=playersSnapshot.docs.filter(document=>
    typeof document.data().duplicateFromPoolId==='string'&&document.data().duplicateFromPoolId
  ).length;
  return {
    ok:true,resetAt,membersReset:trustedSnapshot.size,linksPreserved,
    linkedPlayersReset:resettableLinks.length,linkedPlayersSkipped:linkedPlayers.length-resettableLinks.length,
  };
}

async function relaxHistoricalJoinFloor(request){
  const uid=requireUser(request);
  if(!isGlobalPoolAdmin(request))throw new HttpsError('permission-denied','Only the app administrator can repair a historical Global simulation.');
  const poolId=String(request.data?.poolId||'');
  if(!poolId)throw new HttpsError('invalid-argument','Choose a Global Pool to repair.');
  const poolRef=db.doc(`pools/${poolId}`),poolSnapshot=await poolRef.get();
  if(!poolSnapshot.exists||poolSnapshot.data().global!==true)throw new HttpsError('failed-precondition','Confirmed-watch repair is available only for the Global Pool.');
  const pool=poolSnapshot.data();
  if(!Array.isArray(pool.members)||!pool.members.includes(uid))throw new HttpsError('permission-denied','Join this Global Pool before repairing its confirmed-watch scoring windows.');
  if(pool.members.length>50)throw new HttpsError('failed-precondition','This Global Pool is too large for the controlled historical repair.');
  const seasonId=String(pool.globalSeasonId||pool.season?.id||''),seasonSnapshot=await db.doc(`seasons/${seasonId}`).get();
  if(!seasonSnapshot.exists)throw new HttpsError('failed-precondition','The published season snapshot is unavailable.');
  const cfg=publishedSeasonConfig(seasonSnapshot.data(),seasonId);
  const [trustedSnapshot,playersSnapshot]=await Promise.all([
    poolRef.collection('trustedPlayers').get(),poolRef.collection('players').get(),
  ]);
  const publicPlayers=new Map(playersSnapshot.docs.map(document=>[
    document.id,{ref:document.ref,data:document.data()},
  ]));
  const requestedLinks=playersSnapshot.docs.map(document=>({
    uid:document.id,sourcePoolId:String(document.data().duplicateFromPoolId||''),
  })).filter(link=>link.sourcePoolId);
  const sourcePoolIds=[...new Set(requestedLinks.map(link=>link.sourcePoolId))];
  const [sourcePoolSnapshots,sourcePlayerSnapshots]=await Promise.all([
    Promise.all(sourcePoolIds.map(sourcePoolId=>db.doc(`pools/${sourcePoolId}`).get())),
    Promise.all(requestedLinks.map(link=>db.doc(`pools/${link.sourcePoolId}/players/${link.uid}`).get())),
  ]);
  const sourcePools=new Map(sourcePoolSnapshots.map(snapshot=>[snapshot.id,snapshot]));
  const confirmedLinkedPlayers=new Map();
  requestedLinks.forEach((link,index)=>{
    const sourcePoolSnapshot=sourcePools.get(link.sourcePoolId),sourcePool=sourcePoolSnapshot?.data();
    const sourceSeasonId=String(sourcePool?.season?.id||sourcePool?.seasonId||sourcePool?.globalSeasonId||'');
    const sourcePlayerSnapshot=sourcePlayerSnapshots[index];
    if(
      sourcePoolSnapshot?.exists&&sourcePlayerSnapshot?.exists&&sourcePool?.global!==true&&
      sourceSeasonId===seasonId&&Array.isArray(sourcePool.members)&&sourcePool.members.includes(link.uid)
    )confirmedLinkedPlayers.set(link.uid,{sourcePoolId:link.sourcePoolId,data:sourcePlayerSnapshot.data()});
  });
  const restampedByMember=new Map();
  let picksRestamped=0;
  trustedSnapshot.docs.forEach(document=>{
    const trusted=document.data(),publicPlayer=publicPlayers.get(document.id);
    const linkedPlayer=confirmedLinkedPlayers.get(document.id);
    // Linked friend state is the canonical source because the old public
    // Global mirror could also have promoted its `w` from `watchThrough`.
    const confirmedSource=linkedPlayer?.data||publicPlayer?.data||{};
    const confirmedWatch=advanceGlobalWatchValue(0,confirmedSource.w,cfg.AVAILABLE_THROUGH_EP);
    const repairedLedger={...trusted,joinedAtEp:0,watchedThrough:confirmedWatch};
    const repairedWindow=resolveGlobalWatchWindow(repairedLedger),repairedPicks={...(trusted.picks||{})};
    PHASES.filter(phase=>phase!=='reunion').forEach(phase=>{
      const current=Array.isArray(repairedPicks[phase])?repairedPicks[phase]:[];
      repairedPicks[phase]=current.map(pick=>{
        if(!pick||typeof pick!=='object'||Array.isArray(pick))return pick;
        picksRestamped++;
        return {...pick,w:repairedWindow};
      });
    });
    restampedByMember.set(document.id,{
      trustedRef:document.ref,picks:repairedPicks,confirmedWatch,repairedWindow,
      publicPlayer,linkedPlayer,
    });
  });
  const linkedPickRequests=[];
  restampedByMember.forEach(({linkedPlayer,repairedWindow},memberUid)=>{
    if(!linkedPlayer)return;
    PHASES.filter(phase=>phase!=='reunion').forEach(phase=>linkedPickRequests.push({
      memberUid,phase,repairedWindow,
      ref:db.doc(`pools/${linkedPlayer.sourcePoolId}/phasePicks/${phase}__${memberUid}`),
    }));
  });
  const linkedPickSnapshots=linkedPickRequests.length
    ? await db.getAll(...linkedPickRequests.map(request=>request.ref))
    : [];
  const linkedPickRepairs=linkedPickRequests.map((request,index)=>({
    ...request,snapshot:linkedPickSnapshots[index],
  })).filter(repair=>repair.snapshot.exists);
  const publicPlayerWrites=[...restampedByMember.values()].filter(repair=>repair.publicPlayer).length;
  const writeCount=trustedSnapshot.size+publicPlayerWrites+
    (trustedSnapshot.size*(PHASES.length-1))+linkedPickRepairs.length+1;
  if(writeCount>450)throw new HttpsError('failed-precondition','This Global Pool has too many stored predictions for the controlled historical repair.');
  const repairedAt=Date.now(),batch=db.batch();
  restampedByMember.forEach(({trustedRef,picks,confirmedWatch,publicPlayer},memberUid)=>{
    // Deliberate, tightly scoped exception: this admin-only repair corrects
    // ceiling-stamped historical test picks. Normal locks remain immutable.
    batch.set(trustedRef,{joinedAtEp:0,watchedThrough:confirmedWatch,picks,updatedAt:repairedAt},{merge:true});
    if(publicPlayer)batch.set(publicPlayer.ref,{w:confirmedWatch},{merge:true});
    PHASES.filter(phase=>phase!=='reunion').forEach(phase=>batch.set(
      poolRef.collection('phasePicks').doc(`${phase}__${memberUid}`),
      {uid:memberUid,phase,picks:picks[phase],updatedAt:repairedAt},
      {merge:true},
    ));
  });
  let linkedPicksRestamped=0;
  linkedPickRepairs.forEach(({ref,snapshot,repairedWindow})=>{
    const current=Array.isArray(snapshot.data().picks)?snapshot.data().picks:[];
    const picks=current.map(pick=>{
      if(!pick||typeof pick!=='object'||Array.isArray(pick))return pick;
      linkedPicksRestamped++;
      return {...pick,w:repairedWindow};
    });
    batch.set(ref,{picks,updatedAt:repairedAt},{merge:true});
  });
  // Remove the frozen snapshot so the repaired windows are actually scored.
  batch.delete(poolRef.collection('standings').doc('current'));
  await batch.commit();
  const standings=await recomputeGlobalStandings(poolId);
  return {
    ok:true,membersRepaired:trustedSnapshot.size,picksRestamped,linkedPicksRestamped,
    standingsRevision:standings?.sourceRevision||0,
  };
}

exports.recomputeGlobalStandingsOnSeasonUpdate=onDocumentWritten({...FUNCTION_LIMITS,document:'seasons/{seasonId}'},async event=>{
  if(!event.data?.after.exists)return;
  const poolId=`global__${event.params.seasonId}`;
  const pool=await db.doc(`pools/${poolId}`).get();
  if(pool.exists&&pool.data().global===true)await requestGlobalStandingsRebuild(poolId,'season-updated');
});

exports.deleteMyAccount=onCall(CALLABLE_LIMITS,async request=>{
  const uid=requireUser(request);
  // Read the email before deleting Authentication so recipient-addressed
  // invitation documents can be included in the erasure pass.
  const authUser=await getAuth().getUser(uid);
  const email=String(authUser.email||'').trim().toLowerCase();
  const pools=await db.collection('pools').where('members','array-contains',uid).get();
  for(const poolDoc of pools.docs){
    if(poolDoc.data().ownerUid===uid&&poolDoc.data().global!==true)await db.recursiveDelete(poolDoc.ref);
    else{
      await poolDoc.ref.update({members:FieldValue.arrayRemove(uid)});
      await removeMemberData(poolDoc.ref,uid);
      if(poolDoc.data().global===true)await requestGlobalStandingsRebuild(poolDoc.id,'account-deleted');
    }
  }
  await db.recursiveDelete(db.doc(`castRatingProfiles/${uid}`));
  const inviteQueries=[db.collection('invites').where('fromUid','==',uid)];
  if(email)inviteQueries.push(db.collection('invites').where('toEmail','==',email));
  const inviteSnapshots=await Promise.all(inviteQueries.map(query=>query.get()));
  const inviteRefs=new Map();
  inviteSnapshots.forEach(snapshot=>snapshot.docs.forEach(invite=>inviteRefs.set(invite.ref.path,invite.ref)));
  const rateLimits=await db.collection('inviteRateLimits').where('uid','==',uid).get();
  const [mailSnapshot,feedbackMailSnapshot,feedbackLimitSnapshot]=await Promise.all([
    email?db.collection('mail').where('to','array-contains',email).get():Promise.resolve({docs:[]}),
    db.collection('mail').where('feedbackUserId','==',uid).get(),
    db.collection('feedbackRateLimits').where('uid','==',uid).get(),
  ]);
  await Promise.all([
    ...inviteRefs.values(),
    ...rateLimits.docs.map(limit=>limit.ref),
    ...mailSnapshot.docs.map(mail=>mail.ref),
    ...feedbackMailSnapshot.docs.map(mail=>mail.ref),
    ...feedbackLimitSnapshot.docs.map(limit=>limit.ref),
  ].map(ref=>ref.delete()));
  await db.recursiveDelete(db.doc(`clientErrors/${uid}`));
  await db.doc(`notificationPreferences/${uid}`).delete().catch(()=>{});
  await db.doc(`users/${uid}`).delete().catch(()=>{});
  await getAuth().deleteUser(uid);
  return {ok:true};
});
