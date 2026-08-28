const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const engineSource=fs.readFileSync(path.join(__dirname,'..','functions','shared','scoring-engine.js'),'utf8');
const {makeEngine,validateLockedPhasePicks,freezeScoredTotal}=require('../functions/shared/scoring-engine');
const {advanceGlobalWatchValue,globalJoinFloorForSeason,globalLedgerFieldsForJoin,globalWatchLedgerReady,resolveGlobalWatchWindow}=require('../functions/shared/global-watch-ledger');
assert(source.includes('/* __SCORING_ENGINE_SOURCE__ */'),'The editable app must contain the shared-engine build marker.');

const cast=['Alex','Blair','Casey','Drew'].map(name=>({name}));
const cfg=(couples,reunionMult={still:1,split:2,marriedSplit:2,back:2,newCouple:4.25,lifeUpdate:3.75,absent:2})=>({
  RULES:{POINTS_PER_HEART:1,K:1,LEAD_STEP:.5,WHO_TAG:.25,WEDDINGS_LEAD_STEP:.25,WEDDINGS_LEAD_CAP:1.75,phases:{pods:{budget:200,cap:60},dating:{budget:150,cap:40},weddings:{budget:150,cap:80},reunion:{budget:100,cap:40}}},
  CAST:cast,MEN:['Alex','Blair'],WOMEN:['Casey','Drew'],COUPLES:couples,
  DATING_RESULTS:{sex:{},flirt:{},breakup:{}},
  REUNION_RESULTS:{placeholders:false,still:{},back:{},newCouples:['Blair|Drew'],lifeUpdates:[],absent:[],ready:{still:true,back:true,newCouple:true,lifeUpdate:true,absent:true}},
  RETRO_EVENTS:[],PH_SPAN:{pods:{endEp:4},dating:{endEp:6,retreatStartEp:4,retreatEndEp:6},weddings:{endEp:8},reunion:{endEp:9}},
  PH_STARTW:{pods:1,dating:3,weddings:6,reunion:8},DATING_MULT:{sex:1,flirt:2,breakup:3},WED_MULT:{married:1,saysNo:1.5,calledOff:1.75},REU_MULT:reunionMult,
  RESULTS_READY:{pods:true,dating:true,weddings:true,reunion:true},AVAILABLE_THROUGH_EP:9,SEASON_STATUS:'completed',season:{historical:true},
});

{
  const couples=[{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:3}];
  const engine=makeEngine(cfg(couples),2);
  const scored=engine.scorePhase('pods',{
    unknownPair:[{c:'Blair|Drew',s:15,w:1}],
    knownPair:[{c:'Alex|Casey',s:20,w:1}],
  });
  const miss=scored.entries.find(entry=>entry.member==='unknownPair'&&entry.ok===false&&entry.label==='Blair & Drew did not get engaged');
  assert(miss,'A known-cast Pods pairing absent from Couples must resolve as a miss.');
  assert.equal(miss.stake,15);
  assert.equal(miss.poolSize,2,'The member with the unknown pairing must count as an active Pods player.');
}

{
  const couples=[{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:3}];
  const liveTwo=makeEngine(cfg(couples),2).scorePhase('pods',{
    early:[{c:'Alex|Casey',s:20,w:1}],other:[{c:'Blair|Drew',s:10,w:1}],
  }).totals.early;
  const liveThree=makeEngine(cfg(couples),3).scorePhase('pods',{
    early:[{c:'Alex|Casey',s:20,w:1}],other:[{c:'Blair|Drew',s:10,w:1}],later:[{c:'Blair|Casey',s:10,w:1}],
  }).totals.early;
  assert.notEqual(liveTwo,liveThree,'Friend-pool live denominators must continue changing when another active player joins the phase.');
  assert.equal(freezeScoredTotal(liveTwo,liveThree),liveTwo,'A trusted Global score must retain its first scored total after the population grows.');
}

{
  const season=cfg([{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:3}]);
  season.RULES.phases.pods={...season.RULES.phases.pods,budget:20,cap:15};
  const engine=makeEngine(season,1);
  const accepted=validateLockedPhasePicks({
    engine,phase:'pods',lockedAt:1000,authoritativeWindow:1,
    incoming:[{c:'Alex|Casey',s:15,w:1},{c:'Blair|Drew',s:15,w:1}],
  });
  assert.equal(accepted.length,1,'A pick that would push the phase over its trusted budget must be rejected.');
  assert.equal(engine.spentBy(accepted),15);
}

{
  const season=cfg([{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:5}]);
  season.PH_SPAN.pods.endEp=6;
  const engine=makeEngine(season,1);
  const ledgerWindow=resolveGlobalWatchWindow({watchedThrough:3,joinedAtEp:0});
  const accepted=validateLockedPhasePicks({
    engine,phase:'pods',lockedAt:5000,authoritativeWindow:ledgerWindow,
    incoming:[{c:'Alex|Casey',s:20,w:0,releasedThroughAtLock:5}],
  });
  assert.equal(accepted[0].w,3,'A client-supplied fake foresight window must be replaced by the authoritative ledger window.');
  assert.equal(accepted[0].releasedThroughAtLock,5,'The release-based reference must be retained separately from the scored window.');
  assert.equal(accepted[0].lockedAt,5000);
  const trusted=engine.scorePhase('pods',{viewer:accepted}).totals.viewer;
  const honestUiScore=engine.scorePhase('pods',{viewer:[{c:'Alex|Casey',s:20,w:3}]}).totals.viewer;
  const releaseBasedScore=engine.scorePhase('pods',{viewer:[{c:'Alex|Casey',s:20,w:5}]}).totals.viewer;
  assert.equal(trusted,honestUiScore,'An honest player behind the release schedule must keep the multiplier shown by the board.');
  assert(trusted>releaseBasedScore,'The per-player ledger must restore foresight that the season-wide release window erased.');
}

{
  assert.equal(advanceGlobalWatchValue(3,1,5),3,'The watch ledger must refuse to move backward.');
  assert.equal(advanceGlobalWatchValue(3,9,5),5,'The watch ledger must clamp forward progress to the published release ceiling.');
  assert.equal(advanceGlobalWatchValue(5,3,3),5,'A temporary release rollback must not move the stored ledger backward.');
  assert.equal(globalWatchLedgerReady({watchedThrough:3,joinedAtEp:0}),true,'Both server-held ledger fields make a member ready to lock.');
  assert.equal(globalWatchLedgerReady({watchedThrough:3}),false,'A missing join floor must never silently fall back during a lock.');
  assert.deepEqual(globalLedgerFieldsForJoin({watchedThrough:2,joinedAtEp:1},5),{},'A repeat open must never rewrite an existing join floor.');
  assert.deepEqual(globalLedgerFieldsForJoin({},5),{watchedThrough:0,joinedAtEp:5},'A new member must receive the server release position as their join floor.');
}

{
  const season=cfg([{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:5}]);
  season.PH_SPAN.pods.endEp=6;
  season.AVAILABLE_THROUGH_EP=9;
  season.SEASON_STATUS='completed';
  assert.equal(globalJoinFloorForSeason(season),0,'A fully released historical season must start new Global members at Episode 0.');
  const engine=makeEngine(season,1);
  assert.equal(engine.scorePhase('pods',{viewer:[{c:'Alex|Casey',s:20,w:3}]}).totals.viewer,30,'A pick after Episode 3 for an Episode 5 outcome must earn x1.5.');
  assert.equal(engine.scorePhase('pods',{viewer:[{c:'Alex|Casey',s:20,w:1}]}).totals.viewer,50,'A pick after Episode 1 for an Episode 5 outcome must earn x2.5.');
  const liveSeason={...season,SEASON_STATUS:'live',AVAILABLE_THROUGH_EP:3};
  assert.equal(globalJoinFloorForSeason(liveSeason),3,'A partially released live season must retain the current release position as its join floor.');
  const repaired={watchedThrough:3,joinedAtEp:0};
  assert.equal(resolveGlobalWatchWindow(repaired),3,'Relaxing a historical join floor must preserve the monotonic watched-through ledger.');
}

{
  const season=cfg([{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:5}]);
  season.PH_SPAN.pods.endEp=6;
  const engine=makeEngine(season,1);
  const lateJoinWindow=resolveGlobalWatchWindow({watchedThrough:0,joinedAtEp:5});
  const accepted=validateLockedPhasePicks({
    engine,phase:'pods',lockedAt:6000,authoritativeWindow:lateJoinWindow,
    incoming:[{c:'Alex|Casey',s:20,w:0,releasedThroughAtLock:5}],
  });
  assert.equal(accepted[0].w,5,'A late joiner who watched nothing must be stamped with the join floor.');
  assert.equal(engine.scorePhase('pods',{viewer:accepted}).totals.viewer,20,'The join floor must suppress foresight for episodes released before joining.');
}

{
  const season=cfg([{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:5}]);
  season.PH_SPAN.pods.endEp=6;
  const engine=makeEngine(season,1);
  const existing=[{c:'Alex|Casey',s:20,w:4,releasedThroughAtLock:5,lockedAt:7000}];
  const accepted=validateLockedPhasePicks({
    engine,phase:'pods',lockedAt:8000,authoritativeWindow:1,
    existing,incoming:[{c:'Alex|Casey',s:20,w:0,releasedThroughAtLock:9}],
  });
  assert.deepEqual(accepted,existing,'Previously locked picks must remain unchanged when a duplicate lock is submitted.');
}

{
  const couples=[{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:3}];
  const engine=makeEngine(cfg(couples),1);
  const scored=engine.scorePhase('pods',{viewer:[{c:'Blair|Casey',s:10,w:1}]});
  const misses=scored.entries.filter(entry=>entry.member==='viewer'&&entry.ok===false&&entry.label==='Blair & Casey did not get engaged');
  assert.equal(misses.length,1,'An episode-level impossible miss must not be repeated at phase close.');
}

{
  const couples=[{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:1}];
  const engine=makeEngine(cfg(couples),2);
  const resolved=engine.resolveEpisode('pods',1,{
    matching:[{c:'Alex|Casey',s:20,w:1}],
    contradicted:[{c:'Blair|Casey',s:10,w:1}],
  });
  assert.equal(resolved.events.length,1,'The Episode-1 engagement event must still display.');
  assert.equal(resolved.entries.filter(entry=>entry.ok).length,0,'An Episode-1 engagement must award no hit entries.');
  assert.equal(resolved.entries.filter(entry=>entry.member==='contradicted'&&entry.ok===false).length,1,'Episode-1 contradicted picks must still show an impossible miss.');
  assert.equal(engine.scorePhase('pods',{matching:[{c:'Alex|Casey',s:20,w:1}]}).totals.matching,0);
}

{
  const custom={still:1.1,split:2.2,marriedSplit:2.3,back:2.4,newCouple:4.25,lifeUpdate:3.75,absent:2.6};
  const engine=makeEngine(cfg([],custom),1);
  const scored=engine.scorePhase('reunion',{viewer:[{m:'newCouple',pair:'Blair|Drew',s:20}]});
  const hit=scored.entries.find(entry=>entry.ok&&entry.label==='New couple: Blair & Drew');
  assert(hit,'The custom Reunion new-couple prediction must hit.');
  assert.equal(hit.mult,custom.newCouple);
  assert.equal(hit.points,85);
  ['STILL','SPLIT','MARRIED_SPLIT','BACK','NEW_COUPLE','LIFE_UPDATE','ABSENT'].forEach(key=>{
    assert(source.includes(`numSetting('REUNION_${key}_MULT'`),`REUNION_${key}_MULT must be read from Settings.`);
  });
  assert(source.includes('REU_MULT:reunionMult'),'The settings-derived Reunion multipliers must be returned to scoring.');
}

{
  const couples=[{id:'alex-casey',him:'Alex',her:'Casey',wedding:'married',settledEp:5}];
  const engine=makeEngine(cfg(couples),2);
  const resolved=engine.resolveEpisode('weddings',6,{
    correct:[{c:'alex-casey',o:'married',s:10,w:5}],
    incorrect:[{c:'alex-casey',o:'saysNo',who:'him',s:10,w:5}],
  });
  assert.equal(resolved.events.length,0,'An early-settled wedding result must keep its first-episode event suppressed.');
  assert.equal(resolved.entries.length,2,'Both early-settled wedding predictions must resolve in the first Weddings episode.');
  assert(resolved.entries.some(entry=>entry.member==='correct'&&entry.ok===true&&entry.points>0));
  assert(resolved.entries.some(entry=>entry.member==='incorrect'&&entry.ok===false&&entry.points===0));
  assert(resolved.entries.every(entry=>!entry.multLabel||entry.multLabel.includes('(0 episodes of foresight)')),'Clamped early settlements must not grant negative or impossible foresight.');
}

{
  const couple={id:'alex-casey',him:'Alex',her:'Casey',wedding:'married',weddingEligibleFromEp:5,settledEp:6,lockEp:8,lockEpFallback:true};
  const engine=makeEngine(cfg([couple]),1);
  assert.equal(engine.eligibleForWeddings(couple,5),true,'A wedding market must remain eligible before its settlement is watched.');
  assert.equal(engine.eligibleForWeddings(couple,7),false,'A wedding market must close after its settlement is watched even with a fallback lock episode.');
}

{
  const couples=[{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:3}];
  const engine=makeEngine(cfg(couples),2);
  const scored=engine.scorePhase('pods',{
    stale:[{c:'Blair|Renamed Drew',s:15,w:1}],
    valid:[{c:'Alex|Casey',s:20,w:1}],
  });
  const refund=scored.entries.find(entry=>entry.member==='stale'&&entry.multLabel==='x1 flat refund');
  const hit=scored.entries.find(entry=>entry.member==='valid'&&entry.ok&&entry.label==='Alex & Casey get engaged');
  assert(refund,'An unknown Cast name must produce a visible flat-refund entry.');
  assert.equal(refund.points,15);
  assert.equal(refund.stake,15);
  assert.equal(refund.owners,null);
  assert.equal(hit.owners,1,'A refunded pick must not count as an owner of another prediction.');
  assert.equal(hit.poolSize,1,'A member with only refunded picks must not inflate the active phase pool.');
  assert.equal(hit.points,30);
}

{
  const couples=[{id:'alex-casey',him:'Alex',her:'Casey',podsEligible:true,engagedEp:3}];
  const engine=makeEngine(cfg(couples),2);
  const scored=engine.scorePhase('pods',{
    rounded:[{c:'Alex|Casey',s:7,w:1}],
    tooSmall:[{c:'Blair|Drew',s:3,w:1}],
  });
  const hit=scored.entries.find(entry=>entry.member==='rounded'&&entry.ok);
  assert.equal(hit.stake,5,'A 7-Heart stake must round down to 5 before scoring.');
  assert.equal(scored.entries.filter(entry=>entry.member==='tooSmall').length,0,'A sub-5 stake must be dropped silently.');
  assert.equal(scored.totals.tooSmall,0);
}

{
  const couples=[{id:'alex-casey',him:'Alex',her:'Casey',wedding:'saysNo',who:'him',settledEp:7,reunionStatusEligible:true}];
  const season=cfg(couples);
  season.REUNION_RESULTS.still={'alex-casey':false};
  const engine=makeEngine(season,1);
  const scored=engine.scorePhase('reunion',{viewer:[{m:'relationship',c:'alex-casey',outcome:'marriedSplit',s:20}]});
  const refund=scored.entries.find(entry=>entry.member==='viewer'&&entry.multLabel==='x1 flat refund');
  assert(refund,'A marriedSplit prediction on a non-married couple must refund instead of scoring.');
  assert.equal(refund.mult,1);
  assert.equal(refund.points,20);
  assert.equal(scored.totals.viewer,20);
}

{
  const couples=[{id:'alex-casey',him:'Alex',her:'Casey',wedding:'married',settledEp:7,reunionStatusEligible:false}];
  const engine=makeEngine(cfg(couples),2);
  const scored=engine.scorePhase('reunion',{
    invalidated:[{m:'relationship',c:'alex-casey',outcome:'split',s:25}],
    valid:[{m:'newCouple',pair:'Blair|Drew',s:20}],
  });
  const refund=scored.entries.find(entry=>entry.member==='invalidated'&&entry.multLabel==='x1 flat refund');
  const hit=scored.entries.find(entry=>entry.member==='valid'&&entry.label==='New couple: Blair & Drew');
  assert(refund,'A relationship pick invalidated by current couple eligibility must receive a flat refund.');
  assert.equal(refund.points,25);
  assert.equal(scored.totals.invalidated,25);
  assert.equal(refund.owners,null);
  assert.equal(hit.owners,1,'An invalidated relationship refund must not count as an owner.');
  assert.equal(hit.poolSize,1,'A member with only an invalidated relationship pick must not inflate the active phase pool.');
}

{
  assert(source.includes('Link my Global Pool game'),'Friend-pool creation must offer a linked Global game.');
  assert(source.includes("let activeDuplicateFrom=duplicateFromPoolId||''"),'A friend pool must be allowed to use the Global Pool as its pick source.');
  assert(source.includes('const linkedTargets=linkedMirrorPeers(pickMirrorLinks.current,pending.poolId)'),'Pick synchronization must support either pool type as the target.');
  assert(source.includes('Synced with ${linkedPoolNames.length===1'),'Linked pools must visibly identify their connection below the pool title.');
  assert(source.includes('matchingGlobalPool?.members?.includes(user.uid)'),'The mirror option must be limited to matching Global Pool members.');
}

console.log('Engine audit assertions passed.');
