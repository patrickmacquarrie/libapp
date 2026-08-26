const DEFAULT_DATING_MULT={sex:1,flirt:2,breakup:3};
const DEFAULT_WED_MULT={married:1,saysNo:1.5,calledOff:1.75};
const DEFAULT_REU_MULT={still:1,split:2,marriedSplit:2,back:2,newCouple:5,lifeUpdate:5,absent:2};
let DATING_MULT = {...DEFAULT_DATING_MULT};
let WED_MULT  = {...DEFAULT_WED_MULT};
// Wedding values: married, saysNo, calledOff, notShown (engagement aired, post-Pods arc not shown).
const WED_LABEL = {married:'Get married',saysNo:'Says no at the altar',calledOff:'Called off before the altar',notShown:'Never aired past the pods'};
const FLIRT_SHORT = 'Flirts with someone else';
let REU_MULT  = {...DEFAULT_REU_MULT};
const LIFE_UPD  = {newPartner:'Married or Engaged to Someone New',newBaby:'Pregnant or New Baby'};
const normalizeLifeUpdate = value => ({engagedNew:'newPartner',marriedNew:'newPartner',kid:'newBaby'}[value]||value);
const PH_ORDER  = ['pods','dating','weddings','reunion'];
const DEFAULT_PH_SPAN = {pods:{endEp:6},dating:{endEp:9,retreatStartEp:6,retreatEndEp:9},weddings:{endEp:12},reunion:{endEp:13}};
const DEFAULT_PH_STARTW = {pods:1,dating:5,weddings:9,reunion:12};
const DEFAULT_BOUNDARIES_FINAL = {pods:true,dating:true,weddings:true,reunion:true};
const DEFAULT_RESULTS_READY = {pods:true,dating:true,weddings:true,reunion:true};
const cloneDefaultPhaseSpan = () => Object.fromEntries(Object.entries(DEFAULT_PH_SPAN).map(([phase,span])=>[phase,{...span}]));
let PH_SPAN   = cloneDefaultPhaseSpan();
let PH_STARTW = {...DEFAULT_PH_STARTW};
let AVAILABLE_THROUGH_EP = 13;
let BOUNDARIES_FINAL = {...DEFAULT_BOUNDARIES_FINAL};
let RESULTS_READY = {...DEFAULT_RESULTS_READY};
const NEXT_PH   = {pods:'dating',dating:'weddings',weddings:'reunion',reunion:null};
const predictionPhasesAt = (primaryPhase,watchedEp,spans=PH_SPAN,starts=PH_STARTW) => {
  const nextPhase=NEXT_PH[primaryPhase];
  return nextPhase&&watchedEp>=starts[nextPhase]&&watchedEp<spans[primaryPhase].endEp
    ? [primaryPhase,nextPhase]
    : [primaryPhase];
};
const freshPicks = () => ({pods:[],dating:[],weddings:[],reunion:[]});
const legacyRelationshipMarkets=new Set(['still','split','marriedSplit','back']);
const relationshipOutcome = pick => {
  const outcome=pick?.m==='relationship'?pick.outcome:pick?.m;
  return legacyRelationshipMarkets.has(outcome)?outcome:null;
};
const normalizeReunionPick = pick => legacyRelationshipMarkets.has(pick?.m)
  ? {...pick,m:'relationship',outcome:pick.m}
  : pick;
const normalizePicks = value => Object.fromEntries(PH_ORDER.map(ph=>{
  const phasePicks=Array.isArray(value?.[ph])?value[ph]:[];
  return [ph,ph==='reunion'?phasePicks.map(normalizeReunionPick):phasePicks];
}));
const PENDING_SAVE_STORAGE_KEY='prediction-pool-pending-save';
const EMPTY_PHASE_SCORES=Object.freeze({});
function buildGlobalDemoData(meId,meName) {
  const firstNames=['Aaliyah','Alex','Amara','Ben','Bianca','Cam','Carmen','Chris','Dani','Dev','Elena','Eli','Farah','Finn','Gabby','Grace','Hana','Harper','Imani','Ivy','Jalen','Jamie','Kai','Keira','Leo','Lina','Mara','Mateo','Nadia','Noah','Omar','Priya','Quinn','Rae','Remy','Sage','Sam','Talia','Theo','Zara'];
  const phaseEnds={pods:6,dating:9,weddings:12,reunion:13};
  const players={},labels={},statusDocs={},phaseScores={};
  PH_ORDER.forEach(ph=>{phaseScores[ph]={};statusDocs[ph]={completedMembers:[],updatedAt:Date.now()};});
  const addPlayer=(id,name,throughIndex,index,isMe=false)=>{
    const completed={};
    PH_ORDER.forEach((ph,phaseIndex)=>{
      if(phaseIndex>throughIndex)return;
      completed[ph]=true;
      statusDocs[ph].completedMembers.push(id);
      const ranges={pods:[80,420],dating:[60,330],weddings:[95,470],reunion:[70,360]};
      const [minimum,spread]=ranges[ph];
      phaseScores[ph][id]=isMe
        ? ({pods:96,dating:88,weddings:112,reunion:74}[ph])
        : minimum+((index*83+phaseIndex*127+index*index*7)%spread);
    });
    const currentPhase=PH_ORDER[throughIndex];
    players[id]={username:name,picks:freshPicks(),completed,phase:currentPhase,screen:'close',w:phaseEnds[currentPhase],watchThrough:phaseEnds[currentPhase]};
    labels[id]=name;
  };
  for(let index=0;index<125;index++) {
    const percentile=index%100;
    const throughIndex=percentile<28?3:percentile<55?2:percentile<80?1:0;
    const name=firstNames[index%firstNames.length]+' '+String.fromCharCode(65+((index*11)%26))+'.';
    addPlayer('global-demo-'+String(index+1).padStart(3,'0'),name,throughIndex,index);
  }
  addPlayer(meId,meName||'You',3,131,true);
  return {players,labels,statusDocs,phaseScores};
}
const applyRuntimeConfig = cfg => {
  PH_SPAN=cfg.PH_SPAN||PH_SPAN;
  PH_STARTW=cfg.PH_STARTW||PH_STARTW;
  AVAILABLE_THROUGH_EP=Number.isFinite(cfg.AVAILABLE_THROUGH_EP)?cfg.AVAILABLE_THROUGH_EP:AVAILABLE_THROUGH_EP;
  BOUNDARIES_FINAL=cfg.BOUNDARIES_FINAL||BOUNDARIES_FINAL;
  RESULTS_READY=cfg.RESULTS_READY||RESULTS_READY;
  DATING_MULT=cfg.DATING_MULT||DATING_MULT;
  WED_MULT=cfg.WED_MULT||WED_MULT;
  REU_MULT=cfg.REU_MULT||REU_MULT;
  return cfg;
};
const resetRuntimeConfig = () => {
  PH_SPAN=cloneDefaultPhaseSpan();
  PH_STARTW={...DEFAULT_PH_STARTW};
  AVAILABLE_THROUGH_EP=13;
  BOUNDARIES_FINAL={...DEFAULT_BOUNDARIES_FINAL};
  RESULTS_READY={...DEFAULT_RESULTS_READY};
  DATING_MULT={...DEFAULT_DATING_MULT};
  WED_MULT={...DEFAULT_WED_MULT};
  REU_MULT={...DEFAULT_REU_MULT};
};
const rulesSnapshotFrom = cfg => ({
  // Keep this version inside validRulesSnapshot's accepted range in firestore.rules.
  version:5,RULES:cfg.RULES,PH_SPAN:cfg.PH_SPAN,PH_STARTW:cfg.PH_STARTW,
  DATING_MULT:{...(cfg.DATING_MULT||DEFAULT_DATING_MULT)},WED_MULT:{...(cfg.WED_MULT||DEFAULT_WED_MULT)},REU_MULT:{...(cfg.REU_MULT||DEFAULT_REU_MULT)},
});
const configForPool = (liveCfg,pool) => {
  const frozen=pool?.rulesSnapshot;
  if(!frozen) return liveCfg;
  const useLiveBoundaries=liveCfg.BOUNDARIES_LIVE===true;
  const frozenStarts=frozen.PH_STARTW||liveCfg.PH_STARTW;
  const frozenSpans=frozen.PH_SPAN
    ? {...frozen.PH_SPAN,dating:{
        ...liveCfg.PH_SPAN.dating,
        ...frozen.PH_SPAN.dating,
        retreatStartEp:Number.isFinite(frozen.PH_SPAN.dating?.retreatStartEp)
          ? frozen.PH_SPAN.dating.retreatStartEp
          : frozenStarts.dating,
      }}
    : liveCfg.PH_SPAN;
  return {...liveCfg,RULES:frozen.RULES||liveCfg.RULES,PH_SPAN:useLiveBoundaries?liveCfg.PH_SPAN:frozenSpans,PH_STARTW:useLiveBoundaries?liveCfg.PH_STARTW:frozenStarts,DATING_MULT:{...(liveCfg.DATING_MULT||DEFAULT_DATING_MULT),...(frozen.DATING_MULT||{})},WED_MULT:frozen.WED_MULT||WED_MULT,REU_MULT:{...(liveCfg.REU_MULT||DEFAULT_REU_MULT),...(frozen.REU_MULT||{})},RETRO_EVENTS:liveCfg.RETRO_EVENTS||[]};
};
const episodeRangeLabel = (start,end) => start===end?'Episode '+start:'Episodes '+start+'-'+end;
const watchRangeLabel = (phase,start,end) => phase==='reunion'?'the Reunion':episodeRangeLabel(start,end);
function makeEngine(cfg, poolSize) {
  const {RULES,CAST=[],MEN,WOMEN,COUPLES,DATING_RESULTS,REUNION_RESULTS,RETRO_EVENTS=[]} = cfg;
  const SPAN=cfg.PH_SPAN, START=cfg.PH_STARTW;
  const DATING_MARKET_MULT=cfg.DATING_MULT||DEFAULT_DATING_MULT;
  const WEDDING_MULT=cfg.WED_MULT, REUNION_MULT=cfg.REU_MULT;
  const PHASE_RESULTS_READY=cfg.RESULTS_READY;
  const RETREAT_START_EP=Number.isFinite(SPAN.dating.retreatStartEp)?SPAN.dating.retreatStartEp:START.dating;
  const RETREAT_END_EP=Number.isFinite(SPAN.dating.retreatEndEp)?SPAN.dating.retreatEndEp:SPAN.dating.endEp;
  const retreatClosed=Number.isFinite(cfg.AVAILABLE_THROUGH_EP)&&cfg.AVAILABLE_THROUGH_EP>=RETREAT_END_EP;
  const POOL = Math.max(poolSize, 1);
  const byId    = Object.fromEntries(COUPLES.map(c=>[c.id,c]));
  const personKey = value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
  const pairKey = (a,b)=>[personKey(a),personKey(b)].sort().join('|');
  const pairKeyFor = value => {
    const direct=byId[value];
    if(direct) return pairKey(direct.him,direct.her);
    const parts=String(value||'').split('|');
    return parts.length===2?pairKey(parts[0],parts[1]):personKey(value);
  };
  const coupleFor = value => byId[value]||COUPLES.find(c=>pairKey(c.him,c.her)===pairKeyFor(value));
  const sameCouple = (value,couple) => value===couple.id||pairKeyFor(value)===pairKey(couple.him,couple.her);
  const isReal  = k=>!!coupleFor(k);
  const displayName = value => String(value||'').trim().split(/\s+/).map(part=>part?part.charAt(0).toUpperCase()+part.slice(1):part).join(' ');
  const nameOf  = k=>{const c=coupleFor(k);return c?(displayName(c.him)+' & '+displayName(c.her)):String(k).split('|').map(displayName).join(' & ');};
  const membOf  = k=>{const c=coupleFor(k);return c?[c.him,c.her]:String(k).split('|');};
  const whoNm   = (k,w)=>w==='both'?'both':displayName(w==='him'?membOf(k)[0]:membOf(k)[1]);
  const reunionPickLabel = p => {
    const outcome=relationshipOutcome(p);
    return outcome==='still'?nameOf(p.c)+' still together'
      :outcome==='split'?nameOf(p.c)+' no longer together'
      :outcome==='marriedSplit'?nameOf(p.c)+' broken up since marrying'
      :outcome==='back'?nameOf(p.c)+' back together'
      :p.m==='newCouple'?'New couple: '+p.pair.split('|').join(' & ')
      :p.m==='lifeUpdate'?'Life update: '+p.person+' - '+(LIFE_UPD[normalizeLifeUpdate(p.update)]||p.update)
      :p.m==='absent'?'Absent: '+p.person
      :'Retired reunion category';
  };
  const fmt     = n=>String(+n.toFixed(2));
  const leadM   = f=>1+RULES.LEAD_STEP*Math.max(0,f);
  // Weddings spans the long apartments/families/wedding stretch, so its
  // smaller capped curve prevents it from outrunning the shorter uncapped
  // Pods and Retreats curves. The difference is deliberate.
  const weddingLeadM = f=>Math.min(
    Number.isFinite(RULES.WEDDINGS_LEAD_CAP)?RULES.WEDDINGS_LEAD_CAP:1.75,
    1+(Number.isFinite(RULES.WEDDINGS_LEAD_STEP)?RULES.WEDDINGS_LEAD_STEP:0.25)*Math.max(0,f)
  );
  const weddingMarketState = (c,watchedEp) => {
    const lockEp=Number.isFinite(c?.lockEp)?c.lockEp:SPAN.weddings.endEp;
    const playerWatchedThrough=Number.isFinite(watchedEp)?watchedEp:0;
    const open=playerWatchedThrough<lockEp;
    return {
      open,
      lockEp,
      usedFallback:!!c?.lockEpFallback,
      reason:open
        ? `Open until Episode ${lockEp} becomes available`
        : `Locked when Episode ${lockEp} became available`,
    };
  };
  const eligibleForWeddings = (c,w) =>
    c.wedding!=='notShown' &&
    Number.isFinite(c.weddingEligibleFromEp) &&
    c.weddingEligibleFromEp<=w &&
    !(Number.isFinite(c.settledEp)&&c.settledEp<=w) &&
    weddingMarketState(c,w).open;
  const activePoolSize = picksBy => Math.max(Object.values(picksBy).filter(v=>Array.isArray(v)&&v.length>0).length,1);
  const contraV = (o,p=POOL)=>1+RULES.K*(1-o/p);
  const owTxt   = (o,p=POOL)=>o===1?'only prediction':(o===p?'everyone who played this phase predicted it':o+' of '+p+' players who played this phase predicted it');
  const calcPts = (s,m,o,t,p=POOL)=>Math.round(RULES.POINTS_PER_HEART*s*m*contraV(o,p)*(t||1));
  function mk({member,phase,ok,label,stake,mult,multLabel,owners,poolSize=POOL,tag,tagLabel,note,placeholder,pending,retro,retroPhase,retroEventId,predictionAfterEp}) {
    const contra=Number.isFinite(owners)?contraV(owners,poolSize):1;
    return {member,phase,ok:!!ok,label,stake,mult,multLabel,owners,poolSize,contra,tag:tag||1,tagLabel,note,
            placeholder:!!placeholder,pending:!!pending,retro:!!retro,retroPhase,retroEventId,predictionAfterEp:Number.isFinite(predictionAfterEp)?predictionAfterEp:null,points:ok&&!pending?calcPts(stake,mult,owners,tag,poolSize):0};
  }
  const flirtResultFor = person => Object.entries(DATING_RESULTS.flirt).find(([name])=>personKey(name)===personKey(person))?.[1];
  const knownPerson = value => CAST.some(person=>personKey(person.name)===personKey(value));
  const reunionRelationshipGroup = couple => couple?.wedding==='married'?'married'
    :couple?.reunionStatusEligible?'knownDating'
    :couple?.wedding&&couple.wedding!=='notShown'?'split':null;
  const validReunionRelationshipOutcome = (couple,outcome) => {
    const group=reunionRelationshipGroup(couple);
    return group==='married'?['still','marriedSplit'].includes(outcome)
      :group==='knownDating'?['still','split'].includes(outcome)
      :group==='split'&&outcome==='back';
  };
  const refundableInvalidPick = (phase,pick) => {
    if(!pick||typeof pick!=='object'||Array.isArray(pick)) return false;
    if(phase==='pods') {
      const people=membOf(pick.c);
      return people.length===2&&people.some(person=>!knownPerson(person));
    }
    if(phase==='dating') return pick.m==='flirt'?!knownPerson(pick.p):['sex','breakup'].includes(pick.m)&&!coupleFor(pick.c);
    if(phase==='weddings') return !coupleFor(pick.c);
    if(phase==='reunion') {
      const outcome=relationshipOutcome(pick);
      if(outcome) {
        const coupleId=String(pick.c||'').trim();
        if(!coupleId) return false;
        const couple=coupleFor(coupleId);
        // A flat refund also safely covers fabricated ineligible picks because it has no upside over a legitimate market.
        return !couple||!validReunionRelationshipOutcome(couple,outcome);
      }
      if(pick.m==='newCouple') return String(pick.pair||'').split('|').some(person=>!knownPerson(person));
      if(['lifeUpdate','absent'].includes(pick.m)) return !knownPerson(pick.person);
    }
    return false;
  };
  const validPickForPhase = (phase,pick) => {
    if(!pick||typeof pick!=='object'||Array.isArray(pick)) return false;
    if(phase==='pods') {
      const people=membOf(pick.c);
      return people.length===2&&personKey(people[0])!==personKey(people[1])&&people.every(knownPerson);
    }
    if(phase==='dating') {
      if(pick.m==='flirt') return knownPerson(pick.p)&&COUPLES.some(c=>c.datingEligible&&[c.him,c.her].some(name=>personKey(name)===personKey(pick.p)));
      return ['sex','breakup'].includes(pick.m)&&!!coupleFor(pick.c)?.datingEligible;
    }
    if(phase==='weddings') return !!coupleFor(pick.c)&&['married','saysNo','calledOff'].includes(pick.o)&&
      (pick.o==='married'||['him','her'].includes(pick.who));
    if(phase==='reunion') {
      const outcome=relationshipOutcome(pick);
      if(outcome) return validReunionRelationshipOutcome(coupleFor(pick.c),outcome);
      if(pick.m==='newCouple') {
        const people=String(pick.pair||'').split('|');
        return people.length===2&&personKey(people[0])!==personKey(people[1])&&people.every(knownPerson);
      }
      if(pick.m==='lifeUpdate') return knownPerson(pick.person)&&Object.prototype.hasOwnProperty.call(LIFE_UPD,normalizeLifeUpdate(pick.update));
      return pick.m==='absent'&&knownPerson(pick.person);
    }
    return false;
  };
  const pickIdentity = (phase,pick) => {
    if(phase==='pods') return pairKeyFor(pick.c);
    if(phase==='dating') return pick.m+':'+(pick.m==='flirt'?personKey(pick.p):pairKeyFor(pick.c));
    if(phase==='weddings') return pairKeyFor(pick.c);
    if(relationshipOutcome(pick)) return 'relationship:'+pairKeyFor(pick.c);
    if(pick.m==='newCouple') return 'newCouple:'+pairKeyFor(pick.pair);
    if(pick.m==='lifeUpdate') return 'lifeUpdate:'+personKey(pick.person)+':'+normalizeLifeUpdate(pick.update);
    return 'absent:'+personKey(pick.person);
  };
  const sanitizePhasePickState = (phase,picks) => {
    const phaseRules=RULES.phases[phase];
    if(!phaseRules) return {picks:[],refunds:[]};
    const cap=Math.max(0,Number(phaseRules.cap)||0);
    const budget=Math.max(0,Number(phaseRules.budget)||0);
    const seen=new Set(), refunds=[];
    let spent=0;
    const safe=(Array.isArray(picks)?picks:[]).slice(0,40).reduce((safe,raw)=>{
      if(!validPickForPhase(phase,raw)) {
        const rawStake=Number(raw?.s), stake=Number.isFinite(rawStake)?Math.floor(Math.min(cap,rawStake)/5)*5:0;
        if(refundableInvalidPick(phase,raw)&&stake>=5&&spent+stake<=budget) {refunds.push({...raw,s:stake});spent+=stake;}
        return safe;
      }
      const rawStake=Number(raw.s);
      if(!Number.isFinite(rawStake)||rawStake<=0) return safe;
      const stake=Math.floor(Math.min(cap,rawStake)/5)*5;
      // Sub-5 stakes cannot come from the legitimate UI, so drop them without a refund.
      if(stake<5||spent+stake>budget) return safe;
      const identity=pickIdentity(phase,raw);
      if(seen.has(identity)) return safe;
      const pick={...raw,s:stake};
      if(phase!=='reunion') {
        const rawWindow=Number(raw.w);
        if(!Number.isFinite(rawWindow)) {
          if(phase!=='weddings') return safe;
          delete pick.w;
        } else {
          const lastWindow=Math.max(START[phase],SPAN[phase].endEp-1);
          pick.w=Math.max(START[phase],Math.min(Math.trunc(rawWindow),lastWindow));
        }
      } else {
        delete pick.w;
      }
      spent+=stake;
      seen.add(identity);
      safe.push(pick);
      return safe;
    },[]);
    return {picks:safe,refunds};
  };
  const sanitizePhasePicks = (phase,picks) => sanitizePhasePickState(phase,picks).picks;
  const sanitizePicksBy = (phase,picksBy) => Object.fromEntries(
    Object.entries(picksBy||{}).map(([member,picks])=>[member,sanitizePhasePicks(phase,picks)])
  );
  /* Resolve one episode across a set of members. picksBy = {memberUid: picks[]} */
  function resolveEpisode(phase, ep, picksBy) {
    picksBy=sanitizePicksBy(phase,picksBy);
    const MEMBERS = Object.keys(picksBy);
    const all = picksBy;
    const poolSize=activePoolSize(picksBy);
    const mkEntry=entry=>mk({...entry,poolSize});
    const events=[], entries=[];
    if(phase==='pods') {
      const impossiblePodsMisses=new Set();
      COUPLES.filter(c=>c.podsEligible&&Number.isFinite(c.engagedEp)&&c.engagedEp===ep).forEach(c=>{
        const owners=MEMBERS.filter(m=>all[m].some(p=>sameCouple(p.c,c))).length;
        events.push({title:nameOf(c.id)+' got engaged',sub:ep===START.pods?'Episode '+START.pods+' - unavailable for predictions by design; no one scores it.':'Against-the-Grain bonus stays live as more pool members finish Pods.'});
        if(ep!==START.pods) MEMBERS.forEach(m=>all[m].filter(p=>sameCouple(p.c,c)).forEach(p=>{
          const fore=ep-p.w-1;
          entries.push(mkEntry({member:m,phase,ok:true,label:nameOf(c.id)+' get engaged',stake:p.s,mult:leadM(fore),multLabel:'x'+fmt(leadM(fore))+' Against-the-Clock ('+fore+' episodes of foresight)',owners,predictionAfterEp:p.w}));
        }));
        const actualPeople=new Set([c.him,c.her].map(personKey));
        MEMBERS.forEach(m=>all[m].filter(p=>!sameCouple(p.c,c)&&membOf(p.c).some(person=>actualPeople.has(personKey(person)))).forEach(p=>{
          const missKey=m+'|'+pairKeyFor(p.c);
          if(impossiblePodsMisses.has(missKey))return;
          impossiblePodsMisses.add(missKey);
          entries.push(mkEntry({member:m,phase,ok:false,label:nameOf(p.c)+' did not get engaged',stake:p.s,note:'This prediction can no longer hit: '+nameOf(c.id)+' got engaged instead.'}));
        }));
      });
    }
    if(phase==='dating') {
      Object.entries(DATING_RESULTS.sex).filter(([,r])=>r.ep===ep&&r.ep>=RETREAT_START_EP&&r.ep<=RETREAT_END_EP).forEach(([id,r])=>{
        const owners=MEMBERS.filter(m=>all[m].some(p=>p.m==='sex'&&p.c===id)).length;
        events.push({title:'Sleep together: '+nameOf(id)+' (during the retreat, referenced on camera)',sub:'Against-the-Grain bonus stays live as more pool members finish Retreats.',placeholder:!r.confirmed});
        MEMBERS.forEach(m=>all[m].filter(p=>p.m==='sex'&&p.c===id).forEach(p=>{
          const foresight=Math.max(0,ep-p.w-1), clock=leadM(foresight), market=DATING_MARKET_MULT.sex;
          entries.push(mkEntry({member:m,phase,ok:true,pending:!r.confirmed,label:'Sleep together: '+nameOf(id),stake:p.s,mult:market*clock,multLabel:'x'+fmt(market)+' sleep-together x'+fmt(clock)+' Against-the-Clock ('+foresight+' episodes before it was seen)',owners,placeholder:!r.confirmed,note:!r.confirmed?'Awaiting confirmation.':null,predictionAfterEp:p.w}));
        }));
      });
      Object.entries(DATING_RESULTS.flirt).filter(([,r])=>r.ep===ep&&r.ep>=RETREAT_START_EP&&r.ep<=RETREAT_END_EP).forEach(([person,r])=>{
        const owners=MEMBERS.filter(m=>all[m].some(p=>p.m==='flirt'&&flirtResultFor(p.p)===r)).length;
        events.push({title:FLIRT_SHORT+': '+person+' (during the retreat, referenced on camera)',sub:'Against-the-Grain bonus stays live as more pool members finish Retreats.',placeholder:!r.confirmed});
        MEMBERS.forEach(m=>all[m].filter(p=>p.m==='flirt'&&flirtResultFor(p.p)===r).forEach(p=>{
          const foresight=Math.max(0,ep-p.w-1), clock=leadM(foresight), market=DATING_MARKET_MULT.flirt;
          entries.push(mkEntry({member:m,phase,ok:true,pending:!r.confirmed,label:FLIRT_SHORT+': '+person,stake:p.s,mult:market*clock,multLabel:'x'+fmt(market)+' flirt x'+fmt(clock)+' Against-the-Clock ('+foresight+' episodes before it was seen)',owners,placeholder:!r.confirmed,note:!r.confirmed?'Awaiting confirmation.':null,predictionAfterEp:p.w}));
        }));
      });
      Object.entries(DATING_RESULTS.breakup).filter(([,r])=>r.ep===ep&&r.ep>=RETREAT_START_EP&&r.ep<=RETREAT_END_EP).forEach(([id,r])=>{
        const owners=MEMBERS.filter(m=>all[m].some(p=>p.m==='breakup'&&p.c===id)).length;
        events.push({title:'Breaks up during the retreat: '+nameOf(id),sub:'Both members must clearly understand their relationship is over. The Against-the-Grain bonus stays live as more pool members finish Retreats.',placeholder:!r.confirmed});
        MEMBERS.forEach(m=>all[m].filter(p=>p.m==='breakup'&&p.c===id).forEach(p=>{
          const foresight=Math.max(0,ep-p.w-1), clock=leadM(foresight), market=DATING_MARKET_MULT.breakup;
          entries.push(mkEntry({member:m,phase,ok:true,pending:!r.confirmed,label:'Breaks up during the retreat: '+nameOf(id),stake:p.s,mult:market*clock,multLabel:'x'+fmt(market)+' breakup x'+fmt(clock)+' Against-the-Clock ('+foresight+' episodes before it was seen)',owners,placeholder:!r.confirmed,note:!r.confirmed?'Awaiting confirmation.':null,predictionAfterEp:p.w}));
        }));
      });
    }
    if(phase==='weddings') {
      COUPLES.filter(c=>c.wedding&&c.wedding!=='notShown'&&Math.max(Number.isFinite(c.settledEp)?c.settledEp:SPAN.weddings.endEp,START.weddings)===ep).forEach(c=>{
        const out=c.wedding, noOutcomes=['saysNo','calledOff'];
        const actualWho=noOutcomes.includes(out)&&c.who?' ('+whoNm(c.id,c.who)+')':'';
        if (!(ep===START.weddings&&c.settledEp<=START.weddings)) events.push({title:nameOf(c.id)+': '+WED_LABEL[out]+actualWho,sub:c.settledEp===ep&&ep<SPAN.weddings.endEp?'Settled in Episode '+ep+'.':null});
        MEMBERS.forEach(m=>all[m].filter(p=>p.c===c.id).forEach(p=>{
          const baseCorrect=p.o===out||(noOutcomes.includes(p.o)&&noOutcomes.includes(out));
          const predictedLabel=(WED_LABEL[p.o]||String(p.o))+(p.who?' ('+whoNm(c.id,p.who)+')':'');
          const actualLabel=WED_LABEL[out]+actualWho;
          if(baseCorrect) {
            const owners=MEMBERS.filter(mm=>all[mm].some(q=>q.c===c.id&&(q.o===out||(noOutcomes.includes(q.o)&&noOutcomes.includes(out))))).length;
            const whoBonusOutcome=noOutcomes.includes(out);
            const outcomeAfterPick=Number.isFinite(p.w)?ep>p.w:true;
            const timingCorrect=whoBonusOutcome&&p.o===out;
            const whoCorrect=whoBonusOutcome&&outcomeAfterPick&&p.who===c.who;
            // Picks saved before rolling Wedding windows have no `w`; preserve
            // their original flat scoring instead of granting retroactive lead.
            const foresight=Number.isFinite(p.w)?Math.max(0,ep-p.w-1):0;
            const clock=Number.isFinite(p.w)?weddingLeadM(foresight):1;
            const base=out==='married'?WEDDING_MULT.married:1;
            const timingBonus=timingCorrect?WEDDING_MULT[out]:1;
            const whoBonus=whoCorrect?1+RULES.WHO_TAG:1;
            const bonusLabels=[];
            if(timingCorrect) bonusLabels.push(fmt(timingBonus)+' Exact-ending Bonus ('+WED_LABEL[out]+')');
            if(whoCorrect) bonusLabels.push(fmt(whoBonus)+' Who ends it? Bonus ('+whoNm(c.id,c.who)+')');
            const notes=[];
            if(whoBonusOutcome&&!timingCorrect) notes.push('Exact ending predicted '+WED_LABEL[p.o]+'; actual '+WED_LABEL[out]+' - base result points still awarded');
            if(whoBonusOutcome&&p.who&&!whoCorrect) notes.push(outcomeAfterPick?'Person predicted '+whoNm(c.id,p.who)+'; actual '+whoNm(c.id,c.who):'Who-ended-it bonus unavailable because the outcome was not after this prediction');
            entries.push(mkEntry({member:m,phase,ok:true,label:nameOf(c.id)+' - '+(out==='married'?'Get married':'Do not get married')+' · Predicted '+predictedLabel,stake:p.s,mult:base*clock,multLabel:'x'+fmt(base)+' '+(out==='married'?'Get married':'Not married base')+' x'+fmt(clock)+' Against-the-Clock ('+foresight+' episodes of foresight)',owners,tag:timingBonus*whoBonus,tagLabel:bonusLabels.length?bonusLabels.join(' x '):null,note:notes.length?notes.join(' · '):null,predictionAfterEp:p.w}));
          } else {
            entries.push(mkEntry({member:m,phase,ok:false,label:nameOf(c.id)+' - predicted '+predictedLabel,stake:p.s,note:'Actual: '+actualLabel}));
          }
        }));
      });
    }
    if(phase==='reunion'&&ep===SPAN.reunion.endEp) {
      if (REUNION_RESULTS.placeholders) {
        events.push({title:'Reunion results awaiting confirmation',placeholder:true});
        MEMBERS.forEach(m=>all[m].forEach(p=>entries.push(mkEntry({member:m,phase,ok:false,pending:true,label:reunionPickLabel(p),stake:p.s,placeholder:true,note:'Awaiting confirmed reunion results.'}))));
        return {events,entries};
      }
      Object.keys(REUNION_RESULTS.still).forEach(id=>{
        const truth=REUNION_RESULTS.still[id];
        events.push({title:nameOf(id)+': '+(truth?'still together':'no longer together')});
      });
      MEMBERS.forEach(m=>all[m].filter(p=>relationshipOutcome(p)==='still').forEach(p=>{
        const known=Object.prototype.hasOwnProperty.call(REUNION_RESULTS.still,p.c);
        const truth=REUNION_RESULTS.still[p.c], owners=MEMBERS.filter(mm=>all[mm].some(q=>relationshipOutcome(q)==='still'&&q.c===p.c)).length;
        if(!known&&!REUNION_RESULTS.ready.still) entries.push(mkEntry({member:m,phase,ok:false,pending:true,label:nameOf(p.c)+' still together',stake:p.s,note:'Awaiting this couple’s confirmed status.'}));
        else entries.push(truth?mkEntry({member:m,phase,ok:true,label:nameOf(p.c)+' still together',stake:p.s,mult:REUNION_MULT.still,multLabel:'x'+fmt(REUNION_MULT.still)+' still-together',owners}):mkEntry({member:m,phase,ok:false,label:nameOf(p.c)+' still together',stake:p.s,note:'They split.'}));
      }));
      MEMBERS.forEach(m=>all[m].filter(p=>relationshipOutcome(p)==='marriedSplit').forEach(p=>{
        const known=Object.prototype.hasOwnProperty.call(REUNION_RESULTS.still,p.c);
        const truth=REUNION_RESULTS.still[p.c], owners=MEMBERS.filter(mm=>all[mm].some(q=>relationshipOutcome(q)==='marriedSplit'&&q.c===p.c)).length;
        if(!known&&!REUNION_RESULTS.ready.still) entries.push(mkEntry({member:m,phase,ok:false,pending:true,label:nameOf(p.c)+' broken up since marrying',stake:p.s,note:'Awaiting this couple’s confirmed status.'}));
        else entries.push(known&&truth===false?mkEntry({member:m,phase,ok:true,label:nameOf(p.c)+' broken up since marrying',stake:p.s,mult:REUNION_MULT.marriedSplit,multLabel:'x'+fmt(REUNION_MULT.marriedSplit)+' married-couple breakup',owners}):mkEntry({member:m,phase,ok:false,label:nameOf(p.c)+' broken up since marrying',stake:p.s,note:known?'They are still together.':'No breakup was confirmed.'}));
      }));
      MEMBERS.forEach(m=>all[m].filter(p=>relationshipOutcome(p)==='split').forEach(p=>{
        const known=Object.prototype.hasOwnProperty.call(REUNION_RESULTS.still,p.c);
        const truth=REUNION_RESULTS.still[p.c], owners=MEMBERS.filter(mm=>all[mm].some(q=>relationshipOutcome(q)==='split'&&q.c===p.c)).length;
        if(!known&&!REUNION_RESULTS.ready.still) entries.push(mkEntry({member:m,phase,ok:false,pending:true,label:nameOf(p.c)+' no longer together',stake:p.s,note:'Awaiting this couple’s confirmed status.'}));
        else entries.push(known&&truth===false?mkEntry({member:m,phase,ok:true,label:nameOf(p.c)+' no longer together',stake:p.s,mult:REUNION_MULT.split,multLabel:'x'+fmt(REUNION_MULT.split)+' relationship ended',owners}):mkEntry({member:m,phase,ok:false,label:nameOf(p.c)+' no longer together',stake:p.s,note:known?'They are still together.':'No breakup was confirmed.'}));
      }));
      const backIds=Object.keys(REUNION_RESULTS.back).filter(id=>REUNION_RESULTS.back[id]);
      if(REUNION_RESULTS.ready.back) events.push({title:backIds.length?'Back together: '+backIds.map(nameOf).join(', '):'No exes got back together'});
      else events.push({title:'Back-together results awaiting confirmation',placeholder:true});
      MEMBERS.forEach(m=>all[m].filter(p=>relationshipOutcome(p)==='back').forEach(p=>{
        const truth=!!REUNION_RESULTS.back[p.c], owners=MEMBERS.filter(mm=>all[mm].some(q=>relationshipOutcome(q)==='back'&&q.c===p.c)).length;
        if(truth) entries.push(mkEntry({member:m,phase,ok:true,label:nameOf(p.c)+' back together',stake:p.s,mult:REUNION_MULT.back,multLabel:'x'+fmt(REUNION_MULT.back)+' back-together',owners}));
        else if(!REUNION_RESULTS.ready.back) entries.push(mkEntry({member:m,phase,ok:false,pending:true,label:nameOf(p.c)+' back together',stake:p.s,note:'Awaiting confirmed results.'}));
        else entries.push(mkEntry({member:m,phase,ok:false,label:nameOf(p.c)+' back together',stake:p.s,note:'Stayed split.'}));
      }));
      const ncs=REUNION_RESULTS.newCouples;
      if(REUNION_RESULTS.ready.newCouple) events.push({title:ncs.length?'New couple'+(ncs.length>1?'s':'')+': '+ncs.map(v=>v.split('|').join(' & ')).join(', '):'No new couple revealed'});
      else events.push({title:'New-couple results awaiting confirmation',placeholder:true});
      MEMBERS.forEach(m=>all[m].filter(p=>p.m==='newCouple').forEach(p=>{
        const predictionKey=pairKeyFor(p.pair);
        const hit=ncs.some(value=>pairKeyFor(value)===predictionKey), owners=MEMBERS.filter(mm=>all[mm].some(q=>q.m==='newCouple'&&pairKeyFor(q.pair)===predictionKey)).length;
        if(hit) entries.push(mkEntry({member:m,phase,ok:true,label:'New couple: '+p.pair.split('|').join(' & '),stake:p.s,mult:REUNION_MULT.newCouple,multLabel:'x'+fmt(REUNION_MULT.newCouple)+' new couple',owners}));
        else if(!REUNION_RESULTS.ready.newCouple) entries.push(mkEntry({member:m,phase,ok:false,pending:true,label:'New couple: '+p.pair.split('|').join(' & '),stake:p.s,note:'Awaiting confirmed results.'}));
        else entries.push(mkEntry({member:m,phase,ok:false,label:'New couple: '+p.pair.split('|').join(' & '),stake:p.s}));
      }));
      const lus=REUNION_RESULTS.lifeUpdates;
      if(REUNION_RESULTS.ready.lifeUpdate) events.push({title:lus.length?'Life updates: '+lus.map(lu=>lu.person+' - '+(LIFE_UPD[lu.update]||lu.update)).join(', '):'No major life updates'});
      else events.push({title:'Life-update results awaiting confirmation',placeholder:true});
      MEMBERS.forEach(m=>all[m].filter(p=>p.m==='lifeUpdate').forEach(p=>{
        const normalized=normalizeLifeUpdate(p.update);
        const predictedPerson=personKey(p.person);
        const hit=lus.some(lu=>personKey(lu.person)===predictedPerson&&lu.update===normalized), owners=MEMBERS.filter(mm=>all[mm].some(q=>q.m==='lifeUpdate'&&personKey(q.person)===predictedPerson&&normalizeLifeUpdate(q.update)===normalized)).length;
        if(hit) entries.push(mkEntry({member:m,phase,ok:true,label:'Life update: '+p.person+' - '+(LIFE_UPD[normalized]||p.update),stake:p.s,mult:REUNION_MULT.lifeUpdate,multLabel:'x'+fmt(REUNION_MULT.lifeUpdate)+' life update',owners}));
        else if(!REUNION_RESULTS.ready.lifeUpdate) entries.push(mkEntry({member:m,phase,ok:false,pending:true,label:'Life update: '+p.person+' - '+(LIFE_UPD[normalized]||p.update),stake:p.s,note:'Awaiting confirmed results.'}));
        else entries.push(mkEntry({member:m,phase,ok:false,label:'Life update: '+p.person+' - '+(LIFE_UPD[normalized]||p.update),stake:p.s}));
      }));
      const abs=REUNION_RESULTS.absent;
      if(REUNION_RESULTS.ready.absent) events.push({title:abs.length?'Absent: '+abs.join(', '):'Everyone showed up'});
      else events.push({title:'Attendance results awaiting confirmation',placeholder:true});
      MEMBERS.forEach(m=>all[m].filter(p=>p.m==='absent').forEach(p=>{
        const predictedPerson=personKey(p.person);
        const hit=abs.some(person=>personKey(person)===predictedPerson), owners=MEMBERS.filter(mm=>all[mm].some(q=>q.m==='absent'&&personKey(q.person)===predictedPerson)).length;
        if(hit) entries.push(mkEntry({member:m,phase,ok:true,label:'Absent: '+p.person,stake:p.s,mult:REUNION_MULT.absent,multLabel:'x'+fmt(REUNION_MULT.absent)+' absent castmate',owners}));
        else if(!REUNION_RESULTS.ready.absent) entries.push(mkEntry({member:m,phase,ok:false,pending:true,label:'Absent: '+p.person,stake:p.s,note:'Awaiting confirmed results.'}));
        else entries.push(mkEntry({member:m,phase,ok:false,label:'Absent: '+p.person,stake:p.s}));
      }));
    }
    return {events,entries};
  }
  function resolvePhaseClose(phase, picksBy) {
    picksBy=sanitizePicksBy(phase,picksBy);
    const MEMBERS = Object.keys(picksBy), all = picksBy, entries=[];
    const poolSize=activePoolSize(picksBy);
    const mkEntry=entry=>mk({...entry,poolSize});
    if(phase==='pods') MEMBERS.forEach(m=>all[m].forEach(p=>{
      const c=coupleFor(p.c);
      const predictedPeople=new Set(membOf(p.c).map(personKey));
      const contradicted=COUPLES.some(actual=>actual.podsEligible&&Number.isFinite(actual.engagedEp)&&actual.engagedEp<=SPAN.pods.endEp&&!sameCouple(p.c,actual)&&[actual.him,actual.her].some(person=>predictedPeople.has(personKey(person))));
      if(contradicted)return;
      // Keep future relationship developments hidden at the Pods boundary.
      // A later engagement, if applicable, is revealed only by its own retro
      // event once the player has watched that episode.
      if(!c||!c.podsEligible||!Number.isFinite(c.engagedEp)||c.engagedEp>SPAN.pods.endEp) {
        entries.push(mkEntry({member:m,phase,ok:false,label:nameOf(p.c)+' did not get engaged',stake:p.s}));
      }
    }));
    if(phase==='dating') MEMBERS.forEach(m=>all[m].forEach(p=>{
      if(p.m==='breakup'&&!DATING_RESULTS.breakup[p.c]) {
        const pending=!PHASE_RESULTS_READY.dating&&!retreatClosed;
        entries.push(mkEntry({member:m,phase,ok:false,pending,label:'Breaks up during the retreat: '+nameOf(p.c),stake:p.s,note:pending?'Still possible during the retreat.':'They did not both clearly understand the relationship was over during the retreat.'}));
      }
      if(p.m==='sex'&&!DATING_RESULTS.sex[p.c]) {
        const pending=!PHASE_RESULTS_READY.dating&&!retreatClosed;
        entries.push(mkEntry({member:m,phase,ok:false,pending,label:'Sleep together: '+nameOf(p.c),stake:p.s,note:pending?'Still possible during the retreat.':'Not referenced on camera during the retreat.'}));
      }
      if(p.m==='flirt'&&!flirtResultFor(p.p)) {
        const pending=!PHASE_RESULTS_READY.dating&&!retreatClosed;
        entries.push(mkEntry({member:m,phase,ok:false,pending,label:FLIRT_SHORT+': '+p.p,stake:p.s,note:pending?'Still possible during the retreat.':'Not referenced on camera during the retreat.'}));
      }
    }));
    return entries;
  }
  /* Score a phase for the members who have individually completed it. */
  function scorePhase(phase, picksBy) {
    const sanitized=Object.fromEntries(Object.entries(picksBy||{}).map(([member,picks])=>[member,sanitizePhasePickState(phase,picks)]));
    picksBy=Object.fromEntries(Object.entries(sanitized).map(([member,state])=>[member,state.picks]));
    const startEp = phase==='dating'?RETREAT_START_EP:START[phase], endEp = phase==='dating'?RETREAT_END_EP:SPAN[phase].endEp;
    let entries = [];
    for (let ep = startEp; ep <= endEp; ep++) {
      entries = entries.concat(resolveEpisode(phase, ep, picksBy).entries);
    }
    entries = entries.concat(resolvePhaseClose(phase, picksBy));
    Object.entries(sanitized).forEach(([member,state])=>state.refunds.forEach(pick=>{
      const points=Math.round(RULES.POINTS_PER_HEART*pick.s);
      entries.push({member,phase,ok:true,label:'Prediction removed after season data changed',stake:pick.s,mult:1,multLabel:'x1 flat refund',owners:null,poolSize:activePoolSize(picksBy),contra:1,tag:1,note:'This prediction no longer matches the season data. Hearts returned as points.',placeholder:false,pending:false,points});
    }));
    const totals = {};
    Object.keys(picksBy).forEach(m=>totals[m]=0);
    entries.forEach(e=>{ if(!e.pending) totals[e.member]+=e.points; });
    return {entries, totals};
  }
  const retroEventsForRange = (startEp,endEp) => RETRO_EVENTS.filter(event=>event.revealedEp>=startEp&&event.revealedEp<=endEp);
  function scoreRetroAdjustments(picksByPhase, revealedPhaseSet) {
    picksByPhase=Object.fromEntries(PH_ORDER.map(phase=>[phase,sanitizePicksBy(phase,picksByPhase?.[phase]||{})]));
    const memberSet=new Set();
    PH_ORDER.forEach(phase=>Object.keys(picksByPhase?.[phase]||{}).forEach(id=>memberSet.add(id)));
    const MEMBERS=Array.from(memberSet), totals={};
    MEMBERS.forEach(id=>totals[id]=0);
    const entries=[], activeEvents=[];
    const picksFor=(phase,member)=>picksByPhase?.[phase]?.[member]||[];
    const marketMultiplier=(event,pick)=>{
      if(event.market==='still') return REUNION_MULT.still;
      // A post-Pods engagement earns the lead bonus the player had accrued
      // when the Pods closed, never extra foresight from later episodes.
      if(event.market==='pods') return leadM(Math.max(0,SPAN.pods.endEp-(Number.isFinite(pick.w)?pick.w:SPAN.pods.endEp)-1));
      // Retro retreat results have no precise on-screen event episode. Preserve
      // the lead accrued by Retreats close instead of using the later reveal.
      if(['sex','flirt','breakup'].includes(event.market)) {
        const clock=leadM(Math.max(0,RETREAT_END_EP-(Number.isFinite(pick.w)?pick.w:RETREAT_END_EP)-1));
        return DATING_MARKET_MULT[event.market]*clock;
      }
      return 1;
    };
    const matchingPick=(event,pick)=>{
      if(event.market==='pods') {
        const couple=coupleFor(event.target);
        return !!couple&&Number.isFinite(couple.engagedEp)&&sameCouple(pick.c,couple);
      }
      if(event.market==='flirt') return pick.m==='flirt'&&personKey(pick.p)===personKey(event.target);
      if(event.market==='still') return relationshipOutcome(pick)==='still'&&sameCouple(pick.c,coupleFor(event.target));
      return pick.m===event.market&&sameCouple(pick.c,coupleFor(event.target));
    };
    const matchingVoidPick=(event,phase,pick)=>{
      if(event.voidMarket==='pods') return phase==='pods'&&sameCouple(pick.c,coupleFor(event.target));
      if(event.voidMarket==='weddings') return phase==='weddings'&&sameCouple(pick.c,coupleFor(event.target));
      if(event.voidMarket==='flirt') return phase==='dating'&&pick.m==='flirt'&&personKey(pick.p)===personKey(event.target);
      return phase==='dating'&&pick.m===event.voidMarket&&sameCouple(pick.c,coupleFor(event.target));
    };
    const normallyScored=(event,pick)=>{
      if(event.market==='pods') {
        const couple=coupleFor(event.target);
        return !!couple&&couple.podsEligible&&Number.isFinite(couple.engagedEp)&&couple.engagedEp>=START.pods&&couple.engagedEp<=SPAN.pods.endEp;
      }
      if(event.market==='sex') return !!DATING_RESULTS.sex[event.target]?.confirmed;
      if(event.market==='flirt') return !!flirtResultFor(event.target)?.confirmed;
      if(event.market==='breakup') return !!DATING_RESULTS.breakup[event.target]?.confirmed;
      if(event.market==='still') return REUNION_RESULTS.still[event.target]===true;
      return false;
    };
    const voidNormallyScored=(event,phase,pick)=>{
      if(event.voidMarket==='sex') return !!DATING_RESULTS.sex[event.target]?.confirmed;
      if(event.voidMarket==='flirt') return !!flirtResultFor(event.target)?.confirmed;
      if(event.voidMarket==='breakup') return !!DATING_RESULTS.breakup[event.target]?.confirmed;
      if(event.voidMarket==='pods') {
        const couple=coupleFor(event.target);
        return !!couple&&couple.podsEligible&&Number.isFinite(couple.engagedEp)&&couple.engagedEp>=START.pods&&couple.engagedEp<=SPAN.pods.endEp;
      }
      if(event.voidMarket==='weddings') {
        const couple=coupleFor(event.target), noOutcomes=['saysNo','calledOff'];
        return !!couple&&couple.wedding&&couple.wedding!=='notShown'&&(pick.o===couple.wedding||(noOutcomes.includes(pick.o)&&noOutcomes.includes(couple.wedding)));
      }
      return false;
    };
    RETRO_EVENTS.forEach(event=>{
      if(!revealedPhaseSet?.has(event.revealingPhase)) return;
      activeEvents.push(event);
      if(event.market==='void') {
        const phasePicks=picksByPhase?.[event.appliesPhase]||{};
        const poolSize=activePoolSize(phasePicks);
        PH_ORDER.forEach(phase=>{
          MEMBERS.forEach(member=>{
            picksFor(phase,member)
              .filter(pick=>matchingVoidPick(event,phase,pick)&&!voidNormallyScored(event,phase,pick))
              .forEach(pick=>{
                const pending=!event.confirmed, points=pending?0:Math.round(RULES.POINTS_PER_HEART*pick.s);
                const voidLabel=event.voidMarket==='flirt'?FLIRT_SHORT:event.voidMarket;
                const entry={member,phase:event.appliesPhase,ok:true,label:'Voided '+voidLabel+' prediction: '+(event.voidMarket==='flirt'?event.target:nameOf(event.target)),stake:pick.s,mult:1,multLabel:'x1 flat refund',owners:null,poolSize,contra:1,tag:1,note:event.note+' Prediction voided — Hearts returned as points.'+(pending?' Awaiting confirmation.':''),placeholder:false,pending,retro:true,retroPhase:event.revealingPhase,retroEventId:event.id,points};
                entries.push(entry);if(!pending)totals[member]+=points;
              });
          });
        });
        return;
      }
      const phasePicks=picksByPhase?.[event.appliesPhase]||{};
      const poolSize=activePoolSize(phasePicks);
      const owners=MEMBERS.filter(member=>picksFor(event.appliesPhase,member).some(pick=>matchingPick(event,pick)&&!normallyScored(event,pick))).length;
      MEMBERS.forEach(member=>picksFor(event.appliesPhase,member).filter(pick=>matchingPick(event,pick)&&!normallyScored(event,pick)).forEach(pick=>{
        const multiplier=marketMultiplier(event,pick), pending=!event.confirmed;
        const podForesight=event.market==='pods'?Math.max(0,SPAN.pods.endEp-(Number.isFinite(pick.w)?pick.w:SPAN.pods.endEp)-1):0;
        const label=event.market==='pods'?nameOf(event.target)+' got engaged after the Pods':event.market==='flirt'?FLIRT_SHORT+': '+event.target:event.market==='still'?nameOf(event.target)+' still together':event.market==='sex'?'Sleep together: '+nameOf(event.target):'Breaks up during the retreat: '+nameOf(event.target);
        const multLabel=event.market==='pods'
          ? 'x'+fmt(multiplier)+' Pods Against-the-Clock ('+podForesight+' episodes of foresight at Pods close)'
          : ['sex','flirt','breakup'].includes(event.market)
            ? 'x'+fmt(multiplier)+' '+event.market+' market with Retreats-close Against-the-Clock'
            : 'x'+fmt(multiplier)+' '+(event.market==='still'?'still-together':'base');
        const entry=mk({member,phase:event.appliesPhase,ok:true,pending,label,stake:pick.s,mult:multiplier,multLabel,owners,poolSize,note:event.note+(pending?' Awaiting confirmation.':''),retro:true,retroPhase:event.revealingPhase,retroEventId:event.id});
        entries.push(entry);if(!pending)totals[member]+=entry.points;
      }));
    });
    return {entries,totals,events:activeEvents};
  }
  const retroEventMatchesPick=(event,phase,pick)=>{
    if(!event||!pick)return false;
    if(event.market==='void') {
      if(event.voidMarket==='pods') return phase==='pods'&&sameCouple(pick.c,coupleFor(event.target));
      if(event.voidMarket==='weddings') return phase==='weddings'&&sameCouple(pick.c,coupleFor(event.target));
      if(event.voidMarket==='flirt') return phase==='dating'&&pick.m==='flirt'&&personKey(pick.p)===personKey(event.target);
      return phase==='dating'&&pick.m===event.voidMarket&&sameCouple(pick.c,coupleFor(event.target));
    }
    if(phase!==event.appliesPhase)return false;
    if(event.market==='pods')return sameCouple(pick.c,coupleFor(event.target));
    if(event.market==='flirt')return pick.m==='flirt'&&personKey(pick.p)===personKey(event.target);
    if(event.market==='still')return relationshipOutcome(pick)==='still'&&sameCouple(pick.c,coupleFor(event.target));
    return pick.m===event.market&&sameCouple(pick.c,coupleFor(event.target));
  };
  const spentBy = picks => (Array.isArray(picks)?picks:[]).reduce((total,pick)=>total+(Number.isFinite(Number(pick?.s))?Number(pick.s):0),0);
  return {RULES,CAST,MEN,WOMEN,COUPLES,DATING_RESULTS,REUNION_RESULTS,RETRO_EVENTS,RESULTS_READY:PHASE_RESULTS_READY,SEASON_STATUS:cfg.SEASON_STATUS,HISTORICAL:cfg.season?.historical===true,POOL,
          PH_SPAN:SPAN,PH_STARTW:START,DATING_MULT:DATING_MARKET_MULT,WED_MULT:WEDDING_MULT,REU_MULT:REUNION_MULT,
          nameOf,membOf,coupleFor,sameCouple,whoNm,reunionPickLabel,reunionRelationshipGroup,fmt,leadM,weddingLeadM,weddingMarketState,eligibleForWeddings,personKey,pairKeyFor,flirtResultFor,contraV,owTxt,calcPts,
          pickIdentity,resolveEpisode,resolvePhaseClose,scorePhase,scoreRetroAdjustments,retroEventsForRange,retroEventMatchesPick,sanitizePhasePicks,spentBy};
}

function validateLockedPhasePicks({engine,phase,incoming,existing=[],lockedAt,authoritativeWindow}){
  const previous=engine.sanitizePhasePicks(phase,existing);
  const previousByIdentity=new Map(previous.map(pick=>[engine.pickIdentity(phase,pick),pick]));
  const candidates=[...previous];
  (Array.isArray(incoming)?incoming:[]).slice(0,40).forEach(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
    let identity='';
    try{identity=engine.pickIdentity(phase,raw);}catch(error){return;}
    if(!identity||previousByIdentity.has(identity)||candidates.some(pick=>engine.pickIdentity(phase,pick)===identity))return;
    candidates.push({...raw,...(phase==='reunion'?{}:{w:authoritativeWindow}),lockedAt});
  });
  return engine.sanitizePhasePicks(phase,candidates).map(pick=>({...pick,lockedAt:Number(pick.lockedAt)||lockedAt}));
}

const freezeScoredTotal=(previousTotal,recalculatedTotal)=>Number.isFinite(Number(previousTotal))?Number(previousTotal):(Number(recalculatedTotal)||0);

if(typeof module!=='undefined'&&module.exports){
  module.exports={
    makeEngine,rulesSnapshotFrom,configForPool,normalizePicks,normalizeReunionPick,
    relationshipOutcome,normalizeLifeUpdate,PH_ORDER,DEFAULT_DATING_MULT,DEFAULT_WED_MULT,DEFAULT_REU_MULT,
    validateLockedPhasePicks,freezeScoredTotal,
  };
}
