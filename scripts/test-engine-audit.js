const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=source.indexOf('const DEFAULT_DATING_MULT');
const end=source.indexOf('const retroRevealSub');
assert(start>=0&&end>start,'Engine extraction markers must exist.');
const extracted=source.slice(start,end)+'\nmodule.exports={makeEngine};';
const extractedModule={exports:{}};
new Function('module','exports',extracted)(extractedModule,extractedModule.exports);
const {makeEngine}=extractedModule.exports;

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

console.log('Engine audit assertions passed.');
