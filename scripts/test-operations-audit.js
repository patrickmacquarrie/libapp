const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html');
const analyticsSource=read('analytics.js');
const functionsSource=read('functions/index.js');
const scoringEngineSource=read('functions/shared/scoring-engine.js');
const globalWatchLedgerSource=read('functions/shared/global-watch-ledger.js');
const firestoreRules=read('firestore.rules');
const publisher=read('scripts/season-publisher/Code.gs');
const seasonAdmin=read('scripts/season-publisher/Admin.html');
const workflow=read('.github/workflows/deploy-pages.yml');
const runbook=read('SEASON-LAUNCH-RUNBOOK.md');
const liveRunbook=read('LIVE-SEASON-RUNBOOK.md');
const buildSource=read('scripts/build.js');
const firebaseConfig=read('firebase.json');
const productionCsp=firebaseConfig.match(/"key":\s*"Content-Security-Policy",\s*"value":\s*"([^"]+)"/)?.[1]||'';
const firestoreIndexes=JSON.parse(read('firestore.indexes.json'));
const privacy=read('privacy.html');
const readme=read('README.md');
const packageJson=JSON.parse(read('package.json'));
const liveRulesVerifier=read('scripts/verify-live-firestore-rules.js');
const builtAppSmoke=read('scripts/test-built-app-smoke.js');
const globalWatchMigration=read('scripts/migrate-global-watch-ledger.js');

new Function(functionsSource);
new Function(globalWatchLedgerSource);
new Function(globalWatchMigration);
new Function(publisher);
new Function(analyticsSource);
const seasonAdminScript=seasonAdmin.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(seasonAdminScript,'Season admin must include browser logic.');
new Function(seasonAdminScript);

const reunionScoringStart=html.indexOf('const friendReunionScoringState=');
const reunionScoringEnd=html.indexOf('\nfunction Scoreboard',reunionScoringStart);
assert(reunionScoringStart>=0&&reunionScoringEnd>reunionScoringStart,'Could not isolate the friend Reunion scoring helpers.');
const reunionScoringContext={Number,Set};
vm.createContext(reunionScoringContext);
vm.runInContext(`${html.slice(reunionScoringStart,reunionScoringEnd)}\nthis.__friendReunionScoringState=friendReunionScoringState;this.__reunionStandingsGateRequired=reunionStandingsGateRequired;`,reunionScoringContext);
const reunionPlayers={
  locked:{phase:'reunion',screen:'watch',lockedPhases:{reunion:true},completed:{}},
  screenOnly:{phase:'reunion',screen:'watch',completed:{}},
  completed:{phase:'reunion',screen:'close',completed:{reunion:true}},
};
const legacyReunion=reunionScoringContext.__friendReunionScoringState({memberIds:Object.keys(reunionPlayers),playersById:reunionPlayers,completedMembers:['completed'],configVersion:1});
assert.deepEqual(Array.from(legacyReunion.scoredMembers),['completed'],'Legacy configuration must keep scoring only completed Reunion players.');
const v2Reunion=reunionScoringContext.__friendReunionScoringState({memberIds:Object.keys(reunionPlayers),playersById:reunionPlayers,completedMembers:['completed'],configVersion:2});
assert.deepEqual(Array.from(v2Reunion.scoredMembers),['completed','locked'],'Configuration v2 must score a verified immutable Reunion lock without trusting a public screen alone.');
assert.equal(reunionScoringContext.__reunionStandingsGateRequired({next:'standings',globalPool:false,phase:'reunion',screen:'watch',completed:false,configVersion:2}),true);
assert.equal(reunionScoringContext.__reunionStandingsGateRequired({next:'standings',globalPool:false,phase:'reunion',screen:'watch',completed:false,configVersion:1}),false,'UK3 legacy pools must retain their existing tab behavior.');
assert.equal(reunionScoringContext.__reunionStandingsGateRequired({next:'standings',globalPool:true,phase:'reunion',screen:'watch',completed:false,configVersion:2}),false);

const globalJoinWatchStart=html.indexOf('const globalJoinWatchSelection=');
const globalJoinWatchEnd=html.indexOf('\nfunction GlobalPoolJoinModal',globalJoinWatchStart);
assert(globalJoinWatchStart>=0&&globalJoinWatchEnd>globalJoinWatchStart,'Could not isolate the Global join watch selection.');
const globalJoinWatchSelection=vm.runInNewContext(`${html.slice(globalJoinWatchStart,globalJoinWatchEnd)}\nglobalJoinWatchSelection`,{Math,Number});
assert.deepEqual(JSON.parse(JSON.stringify(globalJoinWatchSelection({sourcePoolId:'',availableThroughEp:5,initialWatchedThrough:3}))),{availableThroughEp:5,initialWatchedThrough:3,ask:true});
assert.deepEqual(JSON.parse(JSON.stringify(globalJoinWatchSelection({sourcePoolId:'private-pool',availableThroughEp:5,initialWatchedThrough:3}))),{availableThroughEp:5,initialWatchedThrough:0,ask:false},'A mirror-linked Global join must skip the question and start at zero.');
assert.deepEqual(JSON.parse(JSON.stringify(globalJoinWatchSelection({sourcePoolId:'',availableThroughEp:0,initialWatchedThrough:0}))),{availableThroughEp:0,initialWatchedThrough:0,ask:false},'A pre-premiere Global join must skip the watch question.');
assert.equal(globalJoinWatchSelection({sourcePoolId:'',availableThroughEp:5,initialWatchedThrough:99}).initialWatchedThrough,5,'The client selection must stay inside the published range before the server clamps it again.');

assert(html.includes("doc(db,'clientErrors',user.uid,'categories',category)"),'Client failures must use authenticated Firestore diagnostics.');
assert(html.includes('occurrenceCount:increment(1)'),'Client failure counts must remain bounded to one document per user and category.');
assert(html.includes('lastAt:serverTimestamp()'),'Client failure throttling must use the trusted server timestamp.');
assert(!html.includes("httpsCallable(functions,'reportClientError')"),'Client failures must not use the organization-blocked public callable.');
assert(firestoreRules.includes('match /clientErrors/{userId}/categories/{category}'),'Firestore rules must protect client diagnostics.');
assert(firestoreRules.includes('allow read, delete: if false'),'Browser clients must not read or delete diagnostics.');
assert(firestoreRules.includes("duration.value(1, 'm')"),'Repeated diagnostics must be throttled in Firestore rules.');
['save_failed','season_load_failed','pool_open_failed','pool_create_failed','invite_send_failed','invite_accept_failed','mirror_sync_failed'].forEach(category=>{
  assert(firestoreRules.includes(`'${category}'`),`${category} must be accepted by the diagnostic rules.`);
  assert(html.includes(`reportTtwError('${category}'`),`${category} must be reported by the app.`);
});
assert(!html.includes('data?.message'),'Browser error messages must not be copied into production diagnostics.');
assert(!html.includes('data?.stack'),'Browser stack traces must not be copied into production diagnostics.');
assert(html.includes('listPublishedSeasonSnapshots'),'The app must discover newly published roadmap seasons from Firestore.');
assert(html.includes('applyPublishedSeasonSnapshots'),'Published season snapshots must activate their matching season-library entries.');
assert(html.includes("season.releaseLabel=rl"),'applyPublishedSeasonSnapshots must reconcile releaseLabel from the snapshot Settings onto the season object.');
assert(html.includes("RELEASE_LABEL"),'applyPublishedSeasonSnapshots must extract RELEASE_LABEL from the snapshot Settings array.');
assert(html.includes("defaultSeason?.releaseLabel"),'applyPublicAppConfig must reconcile releaseLabel from the default season metadata.');
assert(html.includes("collection(db,'seasons')"),'Published season discovery must use the protected seasons collection.');
assert(html.includes("raw.length===0&&PUBLISHED_TAB_HEADERS[wanted]"),'Empty live-result tabs must remain usable from a published snapshot.');
assert(html.includes("dating:publishedTabRows(publishedSnapshot,'Dating Results')||[PUBLISHED_TAB_HEADERS.datingresults]"),'A missing Dating Results payload must become an empty header-only dataset.');
assert(html.includes("reunion:publishedTabRows(publishedSnapshot,'Reunion Results')||[PUBLISHED_TAB_HEADERS.reunionresults]"),'A missing Reunion Results payload must become an empty header-only dataset.');
assert(html.includes('const publishedReady=publishedTabs&&publishedTabs.settings?.length;'),'Firestore readiness must allow header-only Cast and Couples tabs when Settings is present.');
assert(html.includes('publishedTabs.settings?.length;'),'Firestore readiness must also depend on Settings.');
assert(!html.includes('publishedTabs.dating?.length&&publishedTabs.reunion?.length'),'Empty live-result tabs must not force the browser onto Google Sheet CSV.');
assert(html.includes("const ADMIN_SEASON_SHEET_FALLBACK=initialAppParams.get('adminSeasonSource')==='sheet';"),'Google Sheet loading must require the explicit admin fallback query parameter.');
assert(html.includes('const useAdminSheetFallback=!publishedReady&&ADMIN_SEASON_SHEET_FALLBACK;'),'The runtime CSV path must be gated behind the explicit admin fallback.');
assert(html.includes('if(!publishedReady&&!useAdminSheetFallback)'),'Normal player traffic must fail closed when the Firestore snapshot is unavailable or incomplete.');
assert(html.includes("eng.DATA_SOURCE==='admin-sheet-fallback'"),'The explicit admin sheet fallback must remain visibly announced in the app.');
assert(readme.includes('?adminSeasonSource=sheet')&&liveRunbook.includes('?adminSeasonSource=sheet')&&runbook.includes('?adminSeasonSource=sheet'),'The emergency admin sheet fallback must be documented with its client/server split warning.');
const castPhotoHelpersStart=html.indexOf('/* CAST PHOTO HELPERS START */');
const castPhotoHelpersEnd=html.indexOf('/* CAST PHOTO HELPERS END */');
assert(castPhotoHelpersStart>=0&&castPhotoHelpersEnd>castPhotoHelpersStart,'Cast photo URL helpers must remain independently testable.');
const castPhotoContext={encodeURIComponent};
vm.createContext(castPhotoContext);
vm.runInContext(`${html.slice(castPhotoHelpersStart,castPhotoHelpersEnd)}\nthis.__localCastPhotoUrl=localCastPhotoUrl;`,castPhotoContext);
assert.equal(castPhotoContext.__localCastPhotoUrl('love-is-blind-us-8','Alex'),'/images/cast/love-is-blind-us-8/Alex.webp','A cast name without a source extension must resolve to its deployed WebP portrait.');
assert.equal(castPhotoContext.__localCastPhotoUrl('love-is-blind-us-8','https://example.com/cast/Sara.png?size=large'),'/images/cast/love-is-blind-us-8/Sara.webp','Published photo paths must resolve to the local optimized portrait.');
assert.equal(castPhotoContext.__localCastPhotoUrl('love-is-blind-us-8',''),'','A missing cast name and photo must not create a broken URL.');
assert(html.includes('getPublicAppConfig'),'The app must read the public live/default season configuration.');
assert(html.includes('const globalPoolSeason=seasonById(defaultSeasonId)'),'The active Global Pool must follow the configured default season.');
assert(!html.includes('Past Global Pools')&&!html.includes('pastGlobalPools'),'Previous Global Pools must not be listed in the player lobby.');
assert(firestoreRules.includes('match /appConfig/public'),'Firestore rules must expose only the public runtime routing document.');

assert(publisher.includes('PropertiesService.getScriptProperties()'),'The publisher must read season configuration from Script properties.');
assert(publisher.includes("backupDocumentPath_(config.seasonId, 'publish', releaseId)"),'Every publish must preserve the previous live snapshot.');
assert(publisher.includes('function rollbackSeasonSnapshot('),'The season publisher must retain a rollback entry point.');
assert(publisher.includes('function previewSeasonSnapshot('),'The season publisher must support a no-write preview.');
assert(publisher.includes('assertMatchesLatestPreview_(config.seasonId, releaseHash)'),'Publishing must require the exact sheet state approved by the latest preview.');
assert(publisher.includes('clearPreviewHash_(config.seasonId)'),'A successful publish must consume its preview approval.');
assert(publisher.includes('assertUniqueSettings_(tabs.Settings)'),'The publisher must reject duplicate Settings keys.');
assert(!publisher.includes("const SEASON_ID ="),'The publisher must not be hardcoded to one season.');
assert(publisher.includes('function doGet()'),'The publisher must serve the season-admin web app.');
assert(publisher.includes('function saveSeasonAdminDraft(payload)'),'The admin must support non-live sheet saves.');
assert(publisher.includes('function previewSeasonFromAdmin(payload)'),'The admin must preserve a read-only preview action.');
assert(publisher.includes('function publishSeasonFromAdmin(seasonId)'),'The admin must publish the previewed sheet without rewriting it from stale form data.');
assert(publisher.includes('commitFirestoreDocuments_(config, writes)'),'Related release documents must be written atomically.');
assert(publisher.includes('validateSeasonAdminPayload_(adminPayloadFromSnapshotTabs_'),'Direct sheet publishing must use the same validation as the admin.');
assert(publisher.includes('validateSeasonAdminPayload_'),'The admin must validate submitted season data on the server.');
assert(publisher.includes('SEASONS_JSON'),'The publisher must support an explicit season allow-list.');
assert(publisher.includes('publisherConfig_(requestedSeasonId)'),'Every publisher action must resolve the selected registered season.');
assert(publisher.includes('function connectSeasonFromAdmin(payload)'),'The admin must be able to connect another season sheet.');
assert(publisher.includes("setProperty('SEASONS_JSON'"),'Connected season sheets must persist in the private allow-list.');
assert(publisher.includes('function setDefaultSeasonFromAdmin(seasonId)'),'The admin must be able to promote a published season to live/default.');
assert(publisher.includes("APP_CONFIG_PATH = 'appConfig/public'"),'The publisher must write the public runtime routing document.');
assert(publisher.includes('Choose another live/default season before publishing this season as Completed.'),'The active default must not be completed before its successor is chosen.');
assert(functionsSource.includes('function globalPoolSeasonFromConfig(data)'),'The Global Pool callable must resolve the active season from runtime configuration.');
assert(!functionsSource.includes('GLOBAL_POOL_SEASONS'),'The Global Pool callable must not retain a hardcoded season allow-list.');
assert(functionsSource.includes("require('./shared/scoring-engine')"),'Cloud Functions must import the same scoring engine used by the browser build.');
assert(buildSource.includes("functions','shared','scoring-engine.js"),'The browser build must inject the Functions scoring engine into the app.');
assert(html.includes('/* __SCORING_ENGINE_SOURCE__ */'),'The editable app must retain the shared scoring-engine insertion marker.');
assert(functionsSource.includes("if(action==='lockGlobalPicks')return lockGlobalPicks(request)"),'Global prediction locks must run through the trusted callable gateway.');
assert(functionsSource.includes("if(action==='completeGlobalPhase')return completeGlobalPhase(request)"),'Global phase completion must run through the trusted callable gateway.');
assert(functionsSource.includes("if(action==='advanceGlobalWatch')return advanceGlobalWatch(request)"),'Global watch progress must run through the existing App Check-protected callable gateway.');
assert(html.includes("httpsCallable(functions,'openGlobalPool')({action:'lockGlobalPicks',poolId,phases})"),'The browser must use the existing callable gateway for Global prediction locks.');
assert(html.includes("httpsCallable(functions,'openGlobalPool')({action:'completeGlobalPhase',poolId,phase})"),'The browser must use the existing callable gateway for Global phase completion.');
assert(html.includes("httpsCallable(functions,'openGlobalPool')({action:'advanceGlobalWatch',poolId,watchedThrough:confirmedWatch})"),'The browser must use the existing callable gateway for confirmed Global watch progress.');
assert(html.includes('Never pass `watchThrough` or an intent/phase-end target here.'),'The trusted-watch client wrapper must state the confirmed-watch invariant.');
assert(html.includes('syncMirroredProgress: (poolId,uid,sourceState,spans,availableThrough) => runTransaction'),'Mirrored Global progress must update the full public checkpoint state monotonically.');
assert(html.includes('if(Number.isFinite(Number(pending.data.w)))'),'A linked source save must synchronize confirmed watch progress in either direction.');
assert(html.includes("operation:'sync_mirrored_progress'"),'Mirrored progress failures must remain observable without blocking the source pool save.');
assert(html.includes('const acceptedGlobalPicks=lockResult?.data?.accepted;'),'The client must inspect the trusted Global lock response.');
assert(html.includes('Number(acceptedGlobalPicks[phaseId])!==submittedGlobalPicks[phaseId].length'),'The client must compare accepted and submitted counts for every locking phase.');
assert(html.includes("error.code='global-picks-rejected'"),'A partial Global lock must surface a distinct review error.');
const globalLockResponseCheck=html.indexOf('const lockResult=await window._fb.lockGlobalPicks(activePool.id,submittedGlobalPicks);');
const persistedWatchScreen=html.indexOf("await savePlayer({picks:creditedPicks,phase,predictionPhases,screen:'watch'",globalLockResponseCheck);
assert(globalLockResponseCheck>=0&&persistedWatchScreen>globalLockResponseCheck,'A Global lock mismatch must be detected before the saved screen advances.');
assert(functionsSource.includes("collection('trustedPlayers').get()"),'The server scorer must use trusted Global inputs.');
assert(functionsSource.includes("publishedRows(snapshot,'Retro Events')"),'The trusted scorer must load confirmed retroactive scoring events.');
assert(functionsSource.includes('.scoreRetroAdjustments(picksByPhase,revealedPhaseSet)'),'The trusted scorer must use the shared engine for retroactive points.');
assert(functionsSource.includes("collection('standings').doc('current')"),'The server scorer must publish one current standings document.');
assert(html.includes('watchGlobalStandings'),'Global clients must subscribe to the single trusted standings document.');
assert(html.includes("if(activePool.global===true){\n      if(poolTab!=='standings'"),'Global standings must bypass the collection fan-out watcher.');
const loadAllPlayersCalls=[...html.matchAll(/window\._fb\.loadAllPlayers\(([^\n]+)\)/g)].map(match=>match[1]);
assert(loadAllPlayersCalls.length>0,'Private-pool loading must retain its bounded player collection path.');
assert(loadAllPlayersCalls.every(call=>call.includes(',false,')),'Every player collection load must be explicitly limited to a private pool.');
assert(!html.includes('window._fb.loadAllPlayers(pool.id,user.uid,true'),'Global pools must never read the players collection.');
assert(scoringEngineSource.includes('validateLockedPhasePicks'),'Trusted pick validation must live with the shared engine.');
assert(functionsSource.includes('authoritativeWindow=resolveGlobalWatchWindow(previous)'),'The scorer must resolve foresight from the server-held per-player ledger.');
assert(functionsSource.includes('releasedThroughAtLock:cfg.AVAILABLE_THROUGH_EP'),'New trusted picks must retain the release-based reference alongside the scored window.');
assert(functionsSource.includes('transaction.set(trustedRef,{watchedThrough},{merge:true})'),'A watch advance must write only the monotonic ledger field.');
assert(globalWatchLedgerSource.includes('resolveGlobalWatchWindow=trusted=>nonNegativeInteger(trusted?.watchedThrough)'),'The scored Global window must use only confirmed watchedThrough.');
assert(!globalWatchLedgerSource.includes('globalJoinFloorForSeason'),'Release status must not create or scale a Global scoring floor.');
assert(globalWatchLedgerSource.includes('fields.joinedAtEp=0'),'A fresh Global ledger must neutralise the legacy join marker.');
assert.equal((functionsSource.match(/globalLedgerFieldsForJoin\(/g)||[]).length,2,'Both Global join paths must use the same player-relative ledger initializer.');
assert(globalWatchLedgerSource.includes('join time do\n// not prove what a player knows'),'The trusted-player anti-backdating design decision must remain explicit.');
const globalLockSource=functionsSource.slice(functionsSource.indexOf('async function lockGlobalPicks('),functionsSource.indexOf('\nasync function completeGlobalPhase('));
assert(globalLockSource.includes('retryAborted(()=>db.runTransaction'),'Trusted Global lock writes must retry transaction contention.');
const globalLockTransaction=globalLockSource.slice(globalLockSource.indexOf('retryAborted(()=>db.runTransaction'));
assert(globalLockSource.indexOf('poolRef.get()')<globalLockSource.indexOf('retryAborted(()=>db.runTransaction')&&globalLockSource.indexOf('seasonRef.get()')<globalLockSource.indexOf('retryAborted(()=>db.runTransaction'),'Pool membership and season configuration must be validated before opening the per-player lock transaction.');
assert(globalLockTransaction.includes('transaction.get(trustedRef)')&&!globalLockTransaction.includes('transaction.get(poolRef)')&&!globalLockTransaction.includes('transaction.get(seasonRef)')&&!globalLockTransaction.includes('transaction.get(profileRef)'),'Global pick locking must hold a read lock only on the trusted player document.');
const globalLockTransactionBody=globalLockTransaction.slice(0,globalLockTransaction.indexOf('\n  }));'));
assert(!globalLockTransactionBody.includes("collection('phasePicks')"),'The contention-sensitive transaction must read and write only the trusted player document.');
assert(globalLockSource.includes('transaction.set(trustedRef,{')&&globalLockSource.includes('scoringVersion:GLOBAL_SCORING_VERSION,picks:nextPicks,updatedAt:lockedAt,'),'Trusted Global lock writes must merge so ledger fields survive.');
assert(!globalLockSource.includes('completedAt:'),'Locking picks must not overwrite a phase completion written by a concurrent request.');
const standingsRebuildSource=functionsSource.slice(functionsSource.indexOf('exports.rebuildGlobalStandings='),functionsSource.indexOf('\nfunction cleanRatings(',functionsSource.indexOf('exports.rebuildGlobalStandings=')));
assert(standingsRebuildSource.includes('failureCount:0'),'A successful standings rebuild must reset the consecutive failure count.');
assert(functionsSource.includes('dirty:failures<3,failureCount:failures'),'A persistent standings rebuild failure must stop dirty retries after three attempts.');
const seasonRebuildSource=functionsSource.slice(functionsSource.indexOf('exports.recomputeGlobalStandingsOnSeasonUpdate='),functionsSource.indexOf('\nexports.deleteMyAccount=',functionsSource.indexOf('exports.recomputeGlobalStandingsOnSeasonUpdate=')));
assert(seasonRebuildSource.includes("requestGlobalStandingsRebuild(poolId,'season-updated')"),'Season updates must enter the same serialized standings rebuild queue.');
assert(!seasonRebuildSource.includes('await recomputeGlobalStandings(poolId)'),'Season updates must not bypass the standings rebuild queue.');
const finishWatchSave=html.indexOf('await savePlayer({picks,phase,predictionPhases:resolvingPhases,screen:nextScreen,w:target,watchThrough:target,completed:nc},true);');
const finishWatchAdvance=html.indexOf("if(activePool.global===true)await window._fb.advanceGlobalWatch(activePool.id,target);");
const finishWatchLocalAdvance=html.indexOf('setW(target);setWatchThrough(target);',finishWatchSave);
assert(finishWatchSave>=0&&finishWatchAdvance>finishWatchSave&&finishWatchLocalAdvance>finishWatchAdvance,'Watch completion must save, advance the trusted ledger, and only then advance local state.');
assert(globalWatchMigration.includes("backfill:{joinedAtEp:0,watchedThrough:0}"),'The migration must state the approved early-tester backfill explicitly.');
assert(globalWatchMigration.includes('withoutLedgerFields'),'The migration must verify that non-ledger fields, including historical picks, remain unchanged.');
assert(!functionsSource.includes('exports.reportClientError'),'The dead client-error callable must stay removed.');
assert(!functionsSource.includes('clientErrorWindows'),'Client error throttling must stay in Firestore rules, not process memory.');
assert(functionsSource.includes('exports.deletePool=onCall'),'Pool deletion must run through a trusted callable.');
assert(functionsSource.includes('await db.recursiveDelete(poolRef)'),'Pool deletion must recursively remove every subcollection.');
assert(html.includes("deletePool: pool => httpsCallable(functions,'deletePool')"),'The browser must use recursive server-side pool deletion.');
assert(!html.includes('6 * members'),'Pool deletion must not rely on one member-sized browser batch.');
assert(functionsSource.includes("_${day}_${invitationCount}`"),'Each deliberate same-day invitation resend must create a distinct mail document.');
assert(!html.includes('already has a pending invitation'),'The invitation form must allow a deliberate same-day resend.');
assert(html.includes("resendingPendingInvite?'Invitation sent again to '"),'The invitation form must clearly confirm a resend.');
assert(functionsSource.includes("db.collection('mail').where('to','array-contains',email)"),'Account deletion must remove queued mail addressed to the user.');
assert(functionsSource.includes("if(request.data?.action==='feedback')return submitFeedback(request)"),'Feedback must be routed through the existing App Check-protected email callable.');
assert(functionsSource.includes('const DAILY_FEEDBACK_LIMIT=5'),'Feedback delivery must have a bounded daily account limit.');
assert(functionsSource.includes("db.collection('mail').where('feedbackUserId','==',uid)"),'Account deletion must remove queued support mail associated with the user.');
assert(functionsSource.includes("db.collection('feedbackRateLimits').where('uid','==',uid)"),'Account deletion must remove feedback rate-limit records.');
assert(html.includes("httpsCallable(functions,'sendPoolInvite')")&&html.includes("action:'feedback'"),'The Settings support form must use the trusted email callable.');
assert(html.includes('supportMessage.trim().length<10'),'The support form must reject empty or trivial messages before sending.');
assert(html.includes('className="ph-no-capture" id="support-message"'),'Feedback message text must be excluded from session replay.');
assert(html.includes('className="settings-modal-close" aria-label="Close settings"'),'Settings must have an accessible close button at the top.');
assert(html.includes('viewport-fit=cover'),'The viewport must fill Safari screens including safe-area devices.');
assert(html.includes('html{width:100%;min-width:0')&&html.includes('.app{width:100%;max-width:760px'),'Safari must receive explicit full-width layout roots.');
assert(html.includes('if(dirty&&!seasonChanged)return;')&&html.includes('[seasonId,myRatingDoc?.updatedAt,dirty]'),'A live Heat Check refresh must not replace an unsaved private draft, while a season change must still hydrate the new season.');
assert(html.includes("poolTab==='chemistry'?refreshChemistryCommunity():refreshStandings()"),'Friend Heat Check activity must refresh community results without reloading the private draft.');
assert(html.includes('await onSave(eng.CAST.filter')&&html.includes('setDirty(false);'),'Heat Check drafts must become clean only after a successful save.');
assert(html.includes("useState(()=>globalPool?false:community?.mySharing!==false)"),'New private-pool Heat Check scorecards must be shared by default while preserving an existing hide choice.');
assert(html.includes("mySharing:entries.find(entry=>entry.uid===currentUid)?.shared"),'Heat Check community loads must return the current player’s saved sharing preference without exposing hidden ratings.');
assert(html.includes('checked={!shareWithFriends}')&&html.includes('Hide my Heat Check picks from this private pool'),'The private-pool privacy control must be an opt-out placed with the save controls.');
assert(html.includes('const includeInGlobal=globalPool||contributeToGlobal===true;')&&html.includes('...(includeInGlobal?{globalRatings:safeRatings}:{})'),'A registered Global Pool player’s private-pool ratings must continue feeding the anonymous global aggregate.');
assert(html.includes('Global averages are anonymous')&&html.includes('They are never shown there with your name or traceable back to your scorecard.'),'Heat Check must explain the Global Pool aggregation privacy boundary.');
assert(html.includes('Start a New Private Pool')&&html.includes('Create a Private Pool'),'The empty lobby must distinguish private pools from the Global Pool.');
assert(html.includes('You’re registered for the Global Pool')&&html.includes('Invite your Friends to Join'),'Prelaunch Global Pool onboarding must confirm registration and invite sharing.');
assert(html.includes('<h3>Email notifications</h3>')&&html.includes('aria-label="Email notification choices"'),'Settings must identify notification choices as email notifications.');
assert(html.includes('Predictions will open on October 14.')&&html.includes('Everyone should watch episode 1 before coming back to make predictions.')&&html.includes('Test the app with past seasons')&&html.includes('onClick={openPastSeasonLibrary}>Start a Past-Season Private Pool')&&html.includes('id="past-season-library"'),'US11 prelaunch copy must set expectations and link to the past-season private-pool library.');
const prelaunchPanelStart=html.indexOf("poolTab==='play' && !cfg.PLAYABLE");
const prelaunchPanelEnd=html.indexOf("poolTab==='play' && cfg.PLAYABLE",prelaunchPanelStart);
const prelaunchPanel=html.slice(prelaunchPanelStart,prelaunchPanelEnd);
assert(prelaunchPanel.indexOf('Invite your Friends to Join')<prelaunchPanel.indexOf('Check for season updates')&&prelaunchPanel.indexOf('Check for season updates')<prelaunchPanel.indexOf('Test the app with past seasons'),'The past-season test path must follow the invite and season-update actions.');
assert(html.includes('One season. Four prediction windows.'),'The signed-out route must explain the season checkpoint structure.');
assert(!html.includes('<PublicTaste/>'),'The signed-out route must not render the interactive prediction demo.');
const enterPoolSource=html.slice(html.indexOf('const enterPool = async'),html.indexOf('\n  const analyticsRoute=',html.indexOf('const enterPool = async')));
assert(enterPoolSource.includes('!enteredPool.rulesSnapshot&&enteredPool.global!==true&&enteredPool.ownerUid===user.uid'),'Only the owner may freeze rules when entering an unfrozen private pool.');
assert(!enterPoolSource.includes('The pool owner needs to open this pool once'),'A non-owner must be able to enter an unfrozen pool using the live season configuration.');
const refreshPoolSource=html.slice(html.indexOf('const refreshPool = async'),html.indexOf('\n  const shareFriendPool = async',html.indexOf('const refreshPool = async')));
assert(refreshPoolSource.includes('!pool.rulesSnapshot&&pool.global!==true&&pool.ownerUid===user.uid'),'Only the owner may freeze rules while refreshing an unfrozen private pool.');
assert(!refreshPoolSource.includes('The pool owner needs to open this pool once'),'A non-owner must be able to refresh an unfrozen pool using the live season configuration.');
assert(analyticsSource.includes("Object.freeze({a:'4.99',c:'12.99'})"),'Pricing research must compare only the two endpoint prices.');
assert(functionsSource.includes('db.recursiveDelete(db.doc(`clientErrors/${uid}`))'),'Account deletion must remove client diagnostics.');
assert(!functionsSource.includes("collectionGroup('members')"),'Half-finished member-subcollection cleanup must not abort account deletion before Phase 5.');
assert(html.includes('updateProfileUsername'),'Username changes must use an update that preserves createdAt.');
assert(firestoreRules.includes('request.resource.data.createdAt == resource.data.createdAt'),'Rules must reject creation-date changes on profile updates.');
assert(firestoreRules.includes("request.auth.token.get('email_verified', false) == true"),'Only verified provider emails may claim invitations.');
assert(readme.includes('Hide My Email'),'Apple relay-address invitation behaviour must be documented before Apple sign-in is enabled.');
assert(html.includes('Reset invite link'),'Pool owners must be able to invalidate a leaked invitation link.');
assert(firestoreRules.includes('function canOwnerChangeJoinCode()'),'Rules must allow owner-only join-code rotation.');
assert(!firestoreRules.includes("request.resource.data.revealed"),'The deprecated phase-status field must never be accepted in a requested document.');
assert(firestoreRules.includes("'updatedAt',\n            'revealed'"),'Rules must permit a full replacement to remove the deprecated phase-status field.');
assert(firestoreRules.includes("data.keys().hasOnly([\n              'username',\n              'phase',\n              'screen'"),'Public player documents must use an explicit field allowlist.');
assert(firebaseConfig.includes('"indexes": "firestore.indexes.json"'),'Firebase deployment must include versioned Firestore indexes.');
assert(functionsSource.includes("const CALLABLE_LIMITS={...FUNCTION_LIMITS,enforceAppCheck:process.env.FUNCTIONS_EMULATOR!=='true'}"),'Every callable must enforce App Check outside the local Firebase emulator.');
assert(!/onCall\(FUNCTION_LIMITS/.test(functionsSource),'No callable may bypass App Check enforcement.');
assert(html.includes('initializeAppCheck(fbApp'),'The production client must initialize Firebase App Check.');
assert(html.includes('new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY)'),'The production client must use reCAPTCHA Enterprise.');
assert(productionCsp.includes('https://www.recaptcha.net')&&productionCsp.includes('https://www.google.com'),'The production CSP must allow reCAPTCHA Enterprise resources.');
assert(firestoreIndexes.indexes.some(index=>index.collectionGroup==='invites'&&index.fields.some(field=>field.fieldPath==='toEmail')&&index.fields.some(field=>field.fieldPath==='status')),'Invite recipient/status index must be versioned.');
assert(firestoreIndexes.indexes.some(index=>index.collectionGroup==='invites'&&index.fields.some(field=>field.fieldPath==='poolId')&&index.fields.some(field=>field.fieldPath==='status')),'Pool invitation/status index must be versioned.');
assert(firestoreIndexes.fieldOverrides.some(index=>index.collectionGroup==='pools'&&index.fieldPath==='season.id'),'Season pool-query index must be versioned.');
assert(privacy.includes('queued email associated with your account'),'Privacy deletion copy must include queued account-associated mail.');
assert(privacy.includes('feedback or support messages you choose to send'),'Privacy copy must disclose submitted support content.');
assert(privacy.includes('Firebase Hosting hosts the website'),'Privacy service-provider copy must name the actual host.');
assert(privacy.includes('technical information needed to operate, improve, and secure the service'),'Coarse browser-context telemetry must remain covered by the technical-information disclosure.');
assert(seasonAdmin.includes('Engagements & Weddings'),'The admin must cover engagement and wedding outcomes.');
assert(seasonAdmin.includes('Retreat outcomes'),'The admin must cover retreat outcomes.');
assert(seasonAdmin.includes('Reunion outcomes'),'The admin must cover Reunion outcomes.');
assert(seasonAdmin.includes('Available through episode'),'The admin must expose episode availability.');
assert(seasonAdmin.includes('id="seasonSelect"'),'The admin must expose a season switcher.');
assert(seasonAdmin.includes('id="connectSeasonButton"'),'The admin must expose a connect-season action.');
assert(seasonAdmin.includes('connectSeasonFromAdmin(request)'),'The connect-season form must use server-side sheet validation.');
assert(seasonAdmin.includes('Make live/default'),'The admin must expose an explicit default-season action.');
assert(seasonAdmin.includes('<svg viewBox="0 0 1024 1024">'),'The season admin must use the Through the Wall app icon.');
assert(seasonAdmin.includes("active='release'"),'Preview failures must open the visible result panel.');
assert(!seasonAdmin.includes('Nothing was published.'),'The admin must not claim that a failed multi-step operation made no live changes.');
assert(seasonAdmin.includes("action==='publish'&&dirty"),'The admin must require a fresh preview after form edits.');
assert(seasonAdmin.includes('publishSeasonFromAdmin(model.seasonId)'),'Publishing must not resend and overwrite the previewed sheet from browser state.');
assert(seasonAdmin.includes('Phase starts must remain chronological')===false,'Server validation details should not be duplicated into the UI source.');

const publisherContext={console};
vm.createContext(publisherContext);
vm.runInContext(publisher+'\nthis.__validateSeasonAdminPayload=validateSeasonAdminPayload_;this.__publisherSeasonRegistry=publisherSeasonRegistryFromProperties_;this.__publisherSpreadsheetId=publisherSpreadsheetId_;this.__upsertPublisherSeason=upsertPublisherSeason_;this.__publisherSeasonMetadata=publisherSeasonMetadata_;this.__assertPublishableSeasonStatus=assertPublishableSeasonStatus_;this.__seasonReleaseComparison=seasonReleaseComparison_;this.__mapFields=mapFields_;',publisherContext);
const seasons=publisherContext.__publisherSeasonRegistry({
  SEASON_ID:'love-is-blind-uk-3',
  SPREADSHEET_ID:'uk3sheet',
  SEASONS_JSON:JSON.stringify([{seasonId:'love-is-blind-br-1',spreadsheetId:'br1sheet',label:'Brazil Season 1'}])
});
assert.equal(seasons.length,2);
assert.equal(seasons[0].seasonId,'love-is-blind-uk-3');
assert.equal(seasons[1].label,'Brazil Season 1');
assert.throws(()=>publisherContext.__publisherSeasonRegistry({SEASONS_JSON:'not json'}),/not valid JSON/i);
assert.throws(()=>publisherContext.__publisherSeasonRegistry({SEASONS_JSON:JSON.stringify([
  {seasonId:'duplicate',spreadsheetId:'one'},
  {seasonId:'duplicate',spreadsheetId:'two'}
])}),/more than once/i);
assert.equal(publisherContext.__publisherSpreadsheetId('https://docs.google.com/spreadsheets/d/1234567890abcdefghij/edit#gid=0'),'1234567890abcdefghij');
assert.equal(publisherContext.__publisherSpreadsheetId('https://docs.google.com/spreadsheets/u/0/d/abcdefghij1234567890/edit'),'abcdefghij1234567890');
assert.throws(()=>publisherContext.__publisherSpreadsheetId('not-a-sheet'),/complete Google Sheet link/i);
const connected=publisherContext.__upsertPublisherSeason(seasons,{seasonId:'love-is-blind-se-1',spreadsheetId:'se1sheet',label:'Sweden Season 1'});
assert.equal(connected.length,3);
assert.equal(connected[2].label,'Sweden Season 1');
assert.throws(()=>publisherContext.__upsertPublisherSeason(connected,{seasonId:'love-is-blind-se-1',spreadsheetId:'other',label:'Wrong'}),/different spreadsheet/i);
assert.throws(()=>publisherContext.__upsertPublisherSeason(connected,{seasonId:'another-season',spreadsheetId:'se1sheet',label:'Wrong'}),/already connected/i);
assert.deepEqual(JSON.parse(JSON.stringify(publisherContext.__publisherSeasonMetadata({seasonId:'love-is-blind-br-4',label:'Brazil Season 4'},'live','Now streaming'))),{
  id:'love-is-blind-br-4',label:'Brazil Season 4',country:'Brazil',countryCode:'BR',seasonNumber:4,locationLabel:null,status:'live',releaseLabel:'Now streaming'
});
const mockScriptProperties={
  PROJECT_ID:'lib-oauth',
  SEASON_ID:'love-is-blind-uk-3',
  SPREADSHEET_ID:'1234567890uk3sheetidabc'
};
publisherContext.PropertiesService={getScriptProperties:()=>({
  getProperties:()=>({...mockScriptProperties}),
  setProperty:(key,value)=>{mockScriptProperties[key]=value;}
})};
publisherContext.SpreadsheetApp={openById:()=>({getSheetByName:tabName=>({tabName})})};
publisherContext.LockService={getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})};
publisherContext.getSeasonAdminData=seasonId=>({seasonId});
const connectedModel=publisherContext.connectSeasonFromAdmin({
  seasonId:'love-is-blind-se-1',
  label:'Sweden Season 1',
  spreadsheetUrl:'https://docs.google.com/spreadsheets/d/1234567890swedensheetid/edit'
});
assert.equal(connectedModel.seasonId,'love-is-blind-se-1');
assert.equal(JSON.parse(mockScriptProperties.SEASONS_JSON).at(-1).label,'Sweden Season 1');
const baseAdminSettings={
  SEASON_STATUS:'upcoming',CAST_COMPLETE:'FALSE',ALLOW_INCOMPLETE_CAST:'FALSE',RELEASE_LABEL:'First episodes soon',AVAILABLE_THROUGH_EP:'0',BOUNDARIES_LIVE:'TRUE',
  PODS_START_EP:'1',PODS_END_EP:'5',DATING_START_EP:'5',DATING_END_EP:'7',RETREAT_START_EP:'5',RETREAT_END_EP:'7',
  WEDDINGS_START_EP:'7',WEDDINGS_END_EP:'11',REUNION_START_EP:'11',REUNION_END_EP:'12',
  PODS_BOUNDARY_FINAL:'FALSE',DATING_BOUNDARY_FINAL:'FALSE',WEDDINGS_BOUNDARY_FINAL:'FALSE',REUNION_BOUNDARY_FINAL:'FALSE',
  PODS_RESULTS_READY:'FALSE',DATING_RESULTS_READY:'FALSE',WEDDINGS_RESULTS_READY:'FALSE',REUNION_RESULTS_READY:'FALSE',
  PODS_BUDGET:'200',PODS_CAP:'60',DATING_BUDGET:'150',DATING_CAP:'40',WEDDINGS_BUDGET:'150',WEDDINGS_CAP:'80',REUNION_BUDGET:'100',REUNION_CAP:'40',
};
const baseAdminPayload={
  settings:baseAdminSettings,
  cast:[{gender:'M',name:'Alex'},{gender:'F',name:'Blair'}],
  couples:[{id:'alex-blair',him:'Alex',her:'Blair',engagedEp:'3',wedding:'',whoSaysNo:'',breakupEp:'',settledEp:'',togetherNow:'',lockEp:'11',podsEligible:'TRUE',datingEligible:'TRUE',reunionStatusEligible:'TRUE'}],
  datingResults:[{market:'sex',coupleId:'alex-blair',episode:'6',person:'',confirmed:'TRUE'}],
  reunionResults:[{market:'still',target:'alex-blair',value:'TRUE',notes:''}],
  retroEvents:[],
};
const validatedAdmin=publisherContext.__validateSeasonAdminPayload(baseAdminPayload);
assert.equal(validatedAdmin.cast.length,2);
assert.equal(validatedAdmin.couples[0].id,'alex-blair');
assert.equal(validatedAdmin.settings.SEASON_STATUS,'upcoming');
assert.equal(validatedAdmin.settings.CAST_COMPLETE,'FALSE');
assert.equal(validatedAdmin.settings.ALLOW_INCOMPLETE_CAST,'FALSE');
assert.equal(publisherContext.__validateSeasonAdminPayload({...baseAdminPayload,settings:{...baseAdminSettings,SEASON_STATUS:'comingSoon'}}).settings.SEASON_STATUS,'upcoming','The legacy status spelling must be saved canonically.');
assert.throws(()=>publisherContext.__assertPublishableSeasonStatus({seasonId:'love-is-blind-br-1'},{explicitStatus:''}),/love-is-blind-br-1.*SEASON_STATUS is empty/i);
assert.doesNotThrow(()=>publisherContext.__assertPublishableSeasonStatus({seasonId:'love-is-blind-br-1'},{explicitStatus:'live',status:'live'}));
assert.throws(()=>publisherContext.__assertPublishableSeasonStatus({seasonId:'love-is-blind-br-1'},{explicitStatus:'mystery',status:'mystery'}),/Upcoming, Live, or Completed/i);
const releaseComparison=publisherContext.__seasonReleaseComparison({snapshot:{
  status:'live',
  Settings:[{key:'CAST_COMPLETE',value:'FALSE'},{key:'ALLOW_INCOMPLETE_CAST',value:'TRUE'},{key:'AVAILABLE_THROUGH_EP',value:'1'},{key:'BOUNDARIES_LIVE',value:'FALSE'},{key:'PODS_BOUNDARY_FINAL',value:'FALSE'},{key:'PODS_RESULTS_READY',value:'FALSE'}],
  Cast:[{name:'Alex'}],Couples:[]
}}, {exists:true,fields:publisherContext.__mapFields({
  status:'live',
  Settings:[{key:'CAST_COMPLETE',value:'FALSE'},{key:'ALLOW_INCOMPLETE_CAST',value:'FALSE'},{key:'AVAILABLE_THROUGH_EP',value:'2'},{key:'BOUNDARIES_LIVE',value:'TRUE'},{key:'PODS_BOUNDARY_FINAL',value:'FALSE'},{key:'PODS_RESULTS_READY',value:'FALSE'}],
  Cast:[{name:'Alex'},{name:'Blair'}],Couples:[{id:'alex-blair'}]
})});
assert.equal(releaseComparison.publishedExists,true);
assert.equal(releaseComparison.settings.find(item=>item.key==='ALLOW_INCOMPLETE_CAST').changed,true);
assert.deepEqual(JSON.parse(JSON.stringify(releaseComparison.rowCounts)),[
  {tab:'Cast',published:2,pending:1,changed:true},
  {tab:'Couples',published:1,pending:0,changed:true}
]);
assert.match(releaseComparison.warnings[0],/AVAILABLE_THROUGH_EP moves backward from 2 to 1/i);
assert.match(releaseComparison.warnings[1],/Incomplete-cast predictions are enabled/i);
assert.equal(publisherContext.__seasonReleaseComparison({snapshot:{status:'live',Settings:[{key:'AVAILABLE_THROUGH_EP',value:'3'}],Cast:[],Couples:[]}},{exists:false,fields:{}}).warnings.length,0);
assert.throws(()=>publisherContext.__validateSeasonAdminPayload({...baseAdminPayload,cast:[...baseAdminPayload.cast,{gender:'M',name:'alex'}]}),/duplicated/i);
assert.throws(()=>publisherContext.__validateSeasonAdminPayload({...baseAdminPayload,datingResults:[{market:'sex',coupleId:'alex-blair',episode:'9',confirmed:'TRUE'}]}),/Episodes 5 and 7/i);
assert.equal(publisherContext.__validateSeasonAdminPayload({...baseAdminPayload,settings:{...baseAdminSettings,SEASON_STATUS:'live',AVAILABLE_THROUGH_EP:'0'}}).settings.AVAILABLE_THROUGH_EP,'0','A live pre-drop season must allow pools at Episode 0.');
const emptyPreDropAdmin=publisherContext.__validateSeasonAdminPayload({
  ...baseAdminPayload,
  settings:{...baseAdminSettings,SEASON_STATUS:'live',AVAILABLE_THROUGH_EP:'0'},
  cast:[],couples:[],datingResults:[],reunionResults:[],retroEvents:[]
});
assert.equal(emptyPreDropAdmin.cast.length,0,'A live pre-drop season must publish without cast rows.');
assert.equal(emptyPreDropAdmin.couples.length,0,'A live pre-drop season must publish without couple rows.');

const castReleaseStart=html.indexOf('/* CAST RELEASE HELPERS START */');
const castReleaseEnd=html.indexOf('/* CAST RELEASE HELPERS END */');
assert(castReleaseStart>=0&&castReleaseEnd>castReleaseStart,'Cast release helpers must remain independently testable.');
const castReleaseContext={};
vm.createContext(castReleaseContext);
vm.runInContext(`const pBool=v=>String(v).toUpperCase()==='TRUE';\n${html.slice(castReleaseStart,castReleaseEnd)}\nthis.__castCompleteSetting=castCompleteSetting;this.__seasonPlayable=seasonPlayable;`,castReleaseContext);
assert.equal(castReleaseContext.__castCompleteSetting('', 'live'),false,'Old live snapshots must default to an incomplete cast.');
assert.equal(castReleaseContext.__castCompleteSetting('', 'comingSoon'),false,'Old upcoming snapshots must default to an incomplete cast.');
assert.equal(castReleaseContext.__castCompleteSetting('', 'completed'),true,'Old completed snapshots must retain historical playability.');
assert.equal(castReleaseContext.__castCompleteSetting('TRUE', 'live'),true,'A live cast can be released explicitly.');
assert.equal(castReleaseContext.__castCompleteSetting('FALSE', 'completed'),false,'An explicit false value must override the compatibility default.');
assert.equal(castReleaseContext.__seasonPlayable(true,true,false,'live'),true,'A complete viable live cast must be playable.');
assert.equal(castReleaseContext.__seasonPlayable(true,false,true,'live'),true,'A deliberate incomplete-cast release must be playable.');
assert.equal(castReleaseContext.__seasonPlayable(true,false,false,'live'),false,'An incomplete cast must remain blocked by default.');
assert.equal(castReleaseContext.__seasonPlayable(false,false,true,'live'),false,'The override must not bypass the viable-cast requirement.');
assert.equal(castReleaseContext.__seasonPlayable(true,false,true,'comingSoon'),false,'The override must not make an upcoming season playable.');
assert.equal(castReleaseContext.__seasonPlayable(true,false,true,'completed'),false,'The override must apply only to live staged releases.');
assert(html.includes("const playable = seasonPlayable(castReady,castComplete,allowIncompleteCast,seasonStatus)&&availableThroughEp>=phaseStart.pods;"),'Playability must keep Episode 0 pools open while predictions remain closed.');
assert(seasonAdmin.includes("SEASON_STATUS:'upcoming',CAST_COMPLETE:'FALSE',ALLOW_INCOMPLETE_CAST:'FALSE'"),'New admin forms must keep incomplete-cast release off by default.');
assert(seasonAdmin.includes('Allow predictions before cast is complete'),'The admin must expose the explicit incomplete-cast release control.');
assert(seasonAdmin.includes("['upcoming','Upcoming']"),'The admin status control must emit the canonical upcoming value.');
const previewPublisherSource=publisher.match(/function previewSeasonSnapshot[\s\S]*?\n}\n\n\/\*\*\n \* Backs up/)[0];
assert(previewPublisherSource.includes('readFirestoreDocument_'),'Preview must read the current published snapshot for comparison.');
assert(!previewPublisherSource.includes('writeFirestoreDocument_'),'Preview must remain strictly read-only.');
assert(seasonAdmin.includes('Backward episode availability appears as a warning.'),'The admin must explain the non-blocking backward-availability warning.');
assert(liveRunbook.includes('Editing the Google Sheet changes nothing in the live app until'),'The live runbook must state that sheet edits require publishing.');
assert(liveRunbook.includes('ALLOW_INCOMPLETE_CAST'),'The live runbook must document deliberate staged-cast releases.');
assert(liveRunbook.includes('Episode 0 keeps predictions closed while allowing pools to form'),'The live runbook must document pre-drop pool creation.');
assert(liveRunbook.includes('After every publish:'),'The live runbook must require verification after each publish.');

const authHelpersStart=html.indexOf('/* AUTH HELPERS START */');
const authHelpersEnd=html.indexOf('/* AUTH HELPERS END */');
assert(authHelpersStart>=0&&authHelpersEnd>authHelpersStart,'The authentication helpers must remain independently testable.');
const authContext={URL,Set};
vm.createContext(authContext);
vm.runInContext(`${html.slice(authHelpersStart,authHelpersEnd)}
this.__authErrorMessage=authErrorMessage;
this.__emailFromSignInUrl=emailFromSignInUrl;
this.__cleanEmailSignInUrl=cleanEmailSignInUrl;
this.__pendingJoinRecord=pendingJoinRecord;
this.__pendingJoinFromRecord=pendingJoinFromRecord;
this.__pendingJoinFromStorageValues=pendingJoinFromStorageValues;`,authContext);
assert.equal(authContext.__authErrorMessage({code:'auth/popup-closed-by-user'}),'');
assert.equal(authContext.__authErrorMessage({code:'auth/cancelled-popup-request'}),'');
assert.match(authContext.__authErrorMessage({code:'auth/network-request-failed'}),/connection/i);
assert.equal(authContext.__authErrorMessage({code:'auth/invalid-email'}),'Enter a valid email address.');
assert(!authContext.__authErrorMessage({code:'auth/unauthorized-domain'}).includes('Firebase'));
assert.equal(authContext.__emailFromSignInUrl('https://throughthewall.ca/?join=pool.code&signInEmail=Player%40Example.com'),'player@example.com');
assert.equal(authContext.__emailFromSignInUrl('https://throughthewall.ca/?mode=signIn&continueUrl=https%3A%2F%2Fthroughthewall.ca%2F%3Fjoin%3Dpool.code%26signInEmail%3DPlayer%2540Example.com'),'player@example.com');
const cleanEmailUrl=new URL(authContext.__cleanEmailSignInUrl('https://throughthewall.ca/?join=pool.code&signInEmail=player%40example.com&mode=signIn&oobCode=secret&apiKey=key'));
assert.equal(cleanEmailUrl.searchParams.get('join'),'pool.code');
['signInEmail','mode','oobCode','apiKey'].forEach(key=>assert.equal(cleanEmailUrl.searchParams.has(key),false,`${key} must be removed after email sign-in.`));
const storedJoin=authContext.__pendingJoinRecord('pool.code',1_000);
assert.equal(authContext.__pendingJoinFromRecord(storedJoin,1_001),'pool.code');
assert.equal(authContext.__pendingJoinFromRecord(storedJoin,1_000+30*60*1000+1),'');
assert.equal(authContext.__pendingJoinFromStorageValues('legacy.pool-code','',1_001),'legacy.pool-code');
assert.equal(authContext.__pendingJoinFromStorageValues('','legacy.pool-code',1_001),'','A non-expiring legacy invite must never be accepted from persistent storage.');
assert.equal(authContext.__pendingJoinFromStorageValues('',storedJoin,1_001),'pool.code','A local fallback must preserve the invite when a mobile auth return loses sessionStorage.');

const gateHelpersStart=html.indexOf('/* EPISODE GATE HELPERS START */');
const gateHelpersEnd=html.indexOf('/* EPISODE GATE HELPERS END */');
assert(gateHelpersStart>=0&&gateHelpersEnd>gateHelpersStart,'Episode gate helpers must remain independently testable.');
const gateContext={};
vm.createContext(gateContext);
vm.runInContext(`${html.slice(gateHelpersStart,gateHelpersEnd)}\nthis.__clampWatchTarget=clampWatchTarget;`,gateContext);
const liveSpans={pods:{endEp:4},dating:{endEp:7}};
assert.equal(gateContext.__clampWatchTarget('pods',1,2,liveSpans,1),1,'A lowered availability ceiling must revoke pending Episode 2 access.');
assert.equal(gateContext.__clampWatchTarget('pods',1,3,liveSpans,2),2,'Pending watch access must stop at the published ceiling.');
assert.equal(gateContext.__clampWatchTarget('pods',2,3,liveSpans,1),2,'Confirmed watched progress must not be rewound when availability moves back.');
assert.equal(gateContext.__clampWatchTarget('pods',3,9,liveSpans,9),4,'Pending watch access must stop at the phase end.');
assert(html.includes('const restoredWatchThrough=clampWatchTarget('),'Pool entry must revalidate saved pending watch access.');
assert(html.includes('const target=clampWatchTarget(phase,w,requestedTarget,PH_SPAN,AVAILABLE_THROUGH_EP);'),'Watch completion must revalidate its target immediately before saving.');
assert(html.includes('if(PH_STARTW.pods>AVAILABLE_THROUGH_EP)'),'Pods start must refuse to cross the availability ceiling.');
assert(html.includes('signInWithRedirect, getRedirectResult'),'Firebase redirect auth must be imported.');
assert(!html.includes('signInWithPopup'),'Google sign-in must avoid popups in link-opening and in-app browsers.');
assert(html.includes("rememberJoinForRedirect();\n  markAuthRedirectPending();\n  try{await signInWithRedirect(auth,provider);}"),'Google sign-in must preserve invite state and mark the redirect before navigation.');
assert(html.includes('localStorage.setItem(AUTH_RETURN_JOIN_KEY,record)'),'Google sign-in must preserve an expiring invite outside sessionStorage for mobile auth returns.');
assert(html.includes('hasPendingFriendInvitation,\n  sendEmailSignInLink'),'The module-scoped invitation helper must be exported through the Firebase bridge.');
assert(html.includes('pendingJoinedPool.current=invitationPool'),'A consumed invitation must open its pool without requiring the link a second time.');
assert(html.includes('<b>Invitation link saved.</b> You won’t need to reopen it after signing in.'),'Signed-out invite links must explain that the invitation was preserved.');
assert(html.includes('authDomain: "throughthewall.ca"'),'Firebase Auth redirects must stay on the production custom domain.');
assert(html.indexOf('await window._fb.completeAuthRedirect()')<html.indexOf('unsubscribe=window._fb.onAuthStateChanged'),'Redirect results must settle before signed-out UI.');
assert(html.includes("trackTtwEvent('sign_in_started',{method:'google'})"),'Google sign-in start must emit a conversion event.');
assert(html.includes('const embeddedBrowser=window.__TTW_EMBEDDED_BROWSER_CONTEXTS__?.includes(window.__TTW_BROWSING_CONTEXT__?.browserContext)===true;')&&html.includes('!embeddedBrowser&&<button className="btn-google"')&&html.includes("className={embeddedBrowser?'btn-primary':'btn-secondary'}"),'Embedded social browsers must hide Google sign-in and make email-link sign-in primary.');
assert(html.includes("Signing in from an app's browser? Use your email, or open this page in Safari or Chrome."),'Embedded social browsers must explain the supported sign-in path.');
assert(html.includes("dispatchAuthConversion('sign_in_redirect_success'"),'Successful redirect resolution must emit a conversion event.');
assert(html.includes("dispatchAuthConversion('sign_in_redirect_failure',{code:"),'Redirect failures must report their auth error code.');
assert(html.includes("trackTtwEvent('app_arrival')"),'Every arrival must emit a conversion event.');
assert(html.includes("const trackTtwEvent=(event,details={})=>window.ttwAnalytics?.track(event,details)"),'Named product analytics must retain one dispatcher.');
assert(analyticsSource.includes('window.posthog?.capture(event,payload)'),'The shared dispatcher must fan every named event out to PostHog.');
assert(!html.includes('posthog.capture('),'PostHog event capture must not be scattered through the app.');
assert(analyticsSource.includes("person_profiles:'identified_only'")&&analyticsSource.includes('capture_pageview:window.__TTW_MANUAL_PAGEVIEWS__?false:true')&&analyticsSource.includes('autocapture:true'),'PostHog must initialize with the beta product-analytics settings and respect manual pageviews.');
assert(html.indexOf('window.__TTW_MANUAL_PAGEVIEWS__=true')<html.indexOf('<script src="analytics.js"></script>'),'The app must disable automatic PostHog pageviews before analytics loads.');
assert(html.includes("const analyticsRoute=!['signedin','signedout','profileerror'].includes(authState)")&&html.includes('if(analyticsRoute)window.ttwAnalytics?.capturePageview(analyticsRoute)'),'Transient authentication routes must not send manual app pageviews.');
assert(analyticsSource.includes("mask_all_text:true")&&analyticsSource.includes("mask_all_element_attributes:true"),'PostHog autocapture must mask rendered text and element attributes.');
const sessionRecordingStart=analyticsSource.indexOf('session_recording:{');
const sessionRecordingEnd=analyticsSource.indexOf('\n      },\n    });',sessionRecordingStart);
assert(sessionRecordingStart>=0&&sessionRecordingEnd>sessionRecordingStart,'PostHog session replay must have an explicit configuration block.');
const sessionRecordingSource=analyticsSource.slice(sessionRecordingStart,sessionRecordingEnd);
assert(sessionRecordingSource.includes('maskAllInputs:true')&&sessionRecordingSource.includes("maskTextSelector:'*'"),'Session replay must use PostHog\'s maximum supported input and rendered-text masking.');
assert(analyticsSource.includes("property_denylist:['email','username','displayName','name','toEmail','inviteEmail']"),'PostHog must drop PII-shaped event properties.');
assert(analyticsSource.includes('mask_personal_data_properties:true')&&analyticsSource.includes("['join','signInEmail','oobCode','apiKey','continueUrl','mode','lang','tenantId']"),'PostHog must mask the configured personal URL properties.');
assert(analyticsSource.includes("window.posthog.identify(String(firebaseUid),{},setOnce)"),'PostHog identity must use only the stable Firebase UID plus set-once cohort properties.');
assert(html.includes("window.ttwAnalytics?.identify(u.uid,{seasonId:"),'Authenticated sessions must identify with the Firebase UID.');
assert(html.includes("window.ttwAnalytics?.reset();identifiedAnalyticsUid.current=''"),'Sign-out and account deletion must reset PostHog identity.');
assert(analyticsSource.includes("const PRIVACY_PROPERTIES=Object.freeze({$geoip_disable:true})"),'PostHog events must opt out of GeoIP enrichment before leaving the browser.');
assert(analyticsSource.includes("window.posthog.register({acquisition_source:cohort,app_build:APP_BUILD,...PRIVACY_PROPERTIES})"),'Acquisition source, app build, and privacy controls must be PostHog super-properties.');
assert(analyticsSource.includes("window.posthog.getFeatureFlag('price_variant')")&&analyticsSource.includes('window.posthog.onFeatureFlags'),'Pricing research must wait for a resolved PostHog feature flag.');
assert(html.includes('if(!pricingPrompt){setPriceVariant(null);return()=>{};}')&&html.includes('window.ttwAnalytics?.onPriceVariant(setPriceVariant)'),'The price flag must not be read until an owner becomes eligible for the prompt.');
assert(html.includes("pricingPrompt?.poolId===activePool.id&&pricingPrice&&<PricingResearchCard"),'The pricing card must not render until a supported price variant has resolved.');
['invite_sent','invite_link_opened','invite_accepted','global_pool_joined','episode_return','notif_opt_in','price_prompt_shown','price_response'].forEach(event=>assert(html.includes(`trackTtwEvent('${event}'`),`${event} must be emitted through the shared dispatcher.`));
assert(!html.includes("trackTtwEvent('price_fakedoor_click'")&&!html.includes("trackTtwEvent('founding_email_captured'"),'The obsolete two-step fake-door events must not remain in the app.');
const saveUsernameStart=html.indexOf('const saveUsername = async () =>');
const changeUsernameStart=html.indexOf('const changeUsername = async rawValue =>',saveUsernameStart);
const addInviteEmailStart=html.indexOf('const addInviteEmail = () =>',changeUsernameStart);
assert(saveUsernameStart>=0&&changeUsernameStart>saveUsernameStart&&addInviteEmailStart>changeUsernameStart,'Could not isolate the username creation and change paths.');
const saveUsernameSource=html.slice(saveUsernameStart,changeUsernameStart);
const changeUsernameSource=html.slice(changeUsernameStart,addInviteEmailStart);
assert(saveUsernameSource.indexOf("trackTtwEvent('account_created'")>saveUsernameSource.indexOf('await window._fb.setProfile('),'account_created must fire only after the initial profile is saved.');
assert(!changeUsernameSource.includes("trackTtwEvent('account_created'"),'Changing an existing username must not fire account_created.');
const phaseCompletionStart=html.indexOf('const registerPhaseCompletion = useCallback(');
const phaseCompletionEnd=html.indexOf('\n  const finishWatch = async',phaseCompletionStart);
assert(phaseCompletionStart>=0&&phaseCompletionEnd>phaseCompletionStart,'Could not isolate the phase-completion path.');
const phaseCompletionSource=html.slice(phaseCompletionStart,phaseCompletionEnd);
assert(!phaseCompletionSource.includes("if(phaseId==='pods')"),'first_checkpoint_locked must not be limited to the Pods phase.');
assert(phaseCompletionSource.includes("const analyticsKey='through-the-wall-first-checkpoint-'+poolId+'-'+uid")&&phaseCompletionSource.includes('if(!localStorage.getItem(analyticsKey))')&&phaseCompletionSource.includes("localStorage.setItem(analyticsKey,'1')"),'first_checkpoint_locked must retain its once-per-pool-per-player localStorage guard.');
assert(phaseCompletionSource.includes('firstCheckpoint&&!globalPool&&activePool?.id===poolId&&activePool.ownerUid===uid&&promptSeason?.id===defaultSeasonId')&&!phaseCompletionSource.includes("promptSeason?.id==='love-is-blind-us-11'")&&phaseCompletionSource.includes('setPricingPrompt({poolId,phase:phaseId,seasonId:promptSeason.id'),'Pricing research must follow the configured live/default season and remain limited to the private-pool owner’s first completed checkpoint.');
assert(phaseCompletionSource.includes("localStorage.getItem('through-the-wall-pricing-prompted-'+uid)==='1'")&&html.includes("localStorage.setItem('through-the-wall-pricing-prompted-'+user.uid,'1')"),'Pricing research must be suppressed per identified user after it is shown on a device.');
assert(html.includes('Help us price private pools')&&html.includes('Your pool is free for all of {seasonLabel}.')&&html.includes("onRespond('yes')")&&html.includes("onRespond('maybe')")&&html.includes("onRespond('no')")&&html.includes("onRespond('dismissed')"),'The pricing card must state the current-season guarantee and collect Yes, Maybe, No, or dismissed.');
assert(html.includes("member_count:memberCount")&&html.includes("response,member_count:memberCount"),'Pricing responses must record the owner’s current private-pool member count.');
assert(html.includes("trackTtwEvent('invite_accepted',{poolId,channel:'link'})"),'A successful invitation-link join must emit invite_accepted.');
assert(html.includes("trackTtwEvent('invite_accepted',{poolId:inv.poolId,channel:'email'})"),'An accepted email invitation must identify its acceptance channel.');
const openGlobalPoolStart=html.indexOf('const openGlobalPool = async season =>');
const joinGlobalPoolStart=html.indexOf('const doJoinGlobalPool = async () =>',openGlobalPoolStart);
const acceptInvitationStart=html.indexOf('const doAccept = async',joinGlobalPoolStart);
assert(openGlobalPoolStart>=0&&joinGlobalPoolStart>openGlobalPoolStart&&acceptInvitationStart>joinGlobalPoolStart,'Could not isolate the Global Pool open and join paths.');
const openGlobalPoolSource=html.slice(openGlobalPoolStart,joinGlobalPoolStart);
const joinGlobalPoolSource=html.slice(joinGlobalPoolStart,acceptInvitationStart);
assert(!openGlobalPoolSource.includes("trackTtwEvent('global_pool_joined'"),'Reopening an existing Global Pool membership must not emit a new join.');
assert(joinGlobalPoolSource.indexOf("trackTtwEvent('global_pool_joined',{seasonId:season.id,initialWatchedThrough,mirrored:!!sourcePoolId})")>joinGlobalPoolSource.indexOf('await window._fb.joinGlobalPool(season,initialWatchedThrough)'),'A successful new Global Pool join must emit its season, starting watch position, and mirror state after the join completes.');
assert(html.includes('className="modal ph-no-capture"'),'Settings must be excluded from session replay so account, pool, email, and support details never leave the browser.');
assert(html.includes('className="pool-row ph-no-capture"'),'User-created pool names must be excluded from session replay.');
assert(html.includes('className="invite-row ph-no-capture"'),'Invitation details must be excluded from session replay.');
assert(html.includes('className="ph-no-capture" id="pool-panel-standings"'),'Player names, scores, and prediction receipts must be excluded from session replay.');
assert(html.includes('className="ph-no-capture" id="pool-panel-chemistry"'),'Heat Check names, scores, and accessibility attributes must be excluded from session replay.');
assert(html.includes('className="ph-no-capture" id="pool-panel-play"'),'Prediction content and contestant accessibility attributes must be excluded from session replay.');

const loadAcquisitionAnalytics=({search='',referrer='',storage=new Map()}={})=>{
  const listeners=new Map();
  class AcquisitionCustomEvent{
    constructor(type,options={}){this.type=type;this.detail=options.detail;}
  }
  const testWindow={
    location:{search,origin:'https://throughthewall.ca',pathname:'/'},
    addEventListener:(type,listener)=>listeners.set(type,listener),
    dispatchEvent:event=>{listeners.get(event.type)?.(event);return true;},
  };
  const testDocument={referrer};
  const testLocalStorage={
    getItem:key=>storage.get(key)||null,
    setItem:(key,value)=>storage.set(key,String(value)),
  };
  vm.runInNewContext(analyticsSource,{window:testWindow,document:testDocument,localStorage:testLocalStorage,URL,URLSearchParams,CustomEvent:AcquisitionCustomEvent});
  const stored=JSON.parse(storage.get('through-the-wall-acquisition')||'{}');
  return {acquisitionSource:testWindow.ttwAnalytics.acquisitionSource,stored,storage};
};
const inviteAcquisition=loadAcquisitionAnalytics({search:'?join=abc.def'});
assert.equal(inviteAcquisition.acquisitionSource,'invite');
assert.equal(inviteAcquisition.stored.acquisition_source,'invite');
assert(!Object.hasOwn(inviteAcquisition.stored,'join'),'The private pool join code must never be persisted with acquisition data.');
const restoredInviteAcquisition=loadAcquisitionAnalytics({storage:inviteAcquisition.storage});
assert.equal(restoredInviteAcquisition.acquisitionSource,'invite','Invite acquisition must survive the authentication redirect.');
const paidStorage=new Map([['through-the-wall-acquisition',JSON.stringify({fbclid:'x'})]]);
assert.equal(loadAcquisitionAnalytics({search:'?join=abc.def',storage:paidStorage}).acquisitionSource,'paid_meta','A later invitation must not overwrite an earlier paid first touch.');
const inviteWithUtm=loadAcquisitionAnalytics({search:'?join=abc.def&utm_source=tiktok'});
assert.equal(inviteWithUtm.acquisitionSource,'invite');
assert.equal(inviteWithUtm.stored.utm_source,'tiktok','Invite acquisition must retain accompanying campaign parameters.');
assert(!Object.hasOwn(inviteWithUtm.stored,'join'),'Invite campaign acquisition must not persist the pool join code.');
assert.equal(loadAcquisitionAnalytics().acquisitionSource,'organic_direct','An empty first visit must remain organic direct.');
assert.equal(loadAcquisitionAnalytics({referrer:'https://example.test/article'}).acquisitionSource,'organic_referral','A referred first visit must remain organic referral.');

const emailReturnHelperStart=html.indexOf("const emailSignInReturnUrl=");
const emailReturnHelperEnd=html.indexOf('\n/* AUTH HELPERS END */',emailReturnHelperStart);
assert(emailReturnHelperStart>=0&&emailReturnHelperEnd>emailReturnHelperStart,'Could not isolate the email sign-in return URL helper.');
const emailSignInReturnUrl=vm.runInNewContext(`${html.slice(emailReturnHelperStart,emailReturnHelperEnd)}\nemailSignInReturnUrl`,{URL});
const paidEmailReturn=emailSignInReturnUrl('https://throughthewall.ca/?join=pool.code&utm_campaign=launch','paid_meta');
assert.equal(paidEmailReturn.searchParams.get('acquisition_source'),'paid_meta','Email sign-in must carry the first-touch acquisition source into the destination browser.');
assert.equal(paidEmailReturn.searchParams.get('join'),'pool.code','Email sign-in must preserve the pending invitation parameter.');
assert.equal(paidEmailReturn.searchParams.get('utm_campaign'),'launch','Email sign-in must preserve existing campaign parameters.');
assert.equal(emailSignInReturnUrl('https://throughthewall.ca/?acquisition_source=invite','paid_meta').searchParams.get('acquisition_source'),'invite','Email sign-in must not overwrite an explicit acquisition source.');

const analyticsListeners=new Map();
const analyticsStorage=new Map();
class AnalyticsCustomEvent{
  constructor(type,options={}){this.type=type;this.detail=options.detail;}
}
const analyticsWindow={
  location:{search:'?utm_source=launch_list&utm_medium=email',origin:'https://throughthewall.ca',pathname:'/'},
  addEventListener:(type,listener)=>analyticsListeners.set(type,listener),
  dispatchEvent:event=>{analyticsListeners.get(event.type)?.(event);return true;},
  __TTW_BROWSING_CONTEXT__:{browser_context:'browser'},
  __TTW_MANUAL_PAGEVIEWS__:true,
};
const analyticsDocument={
  referrer:'',
  createElement:()=>({}),
  getElementsByTagName:()=>[{parentNode:{insertBefore:()=>{}}}],
};
const analyticsContext={
  window:analyticsWindow,
  document:analyticsDocument,
  localStorage:{
    getItem:key=>analyticsStorage.get(key)||null,
    setItem:(key,value)=>analyticsStorage.set(key,String(value)),
  },
  URL,
  URLSearchParams,
  Date,
  Object,
  String,
  CustomEvent:AnalyticsCustomEvent,
};
vm.createContext(analyticsContext);
vm.runInContext(
  analyticsSource
    .replaceAll('__POSTHOG_PROJECT_TOKEN__','phc_runtime_audit_token')
    .replaceAll('__POSTHOG_HOST__','https://eu.i.posthog.com')
    .replaceAll('__APP_BUILD_TIMESTAMP__','runtime-audit-build'),
  analyticsContext
);
assert.equal(analyticsWindow.ttwAnalytics.enabled,true,'A built phc_ project token must enable PostHog.');
assert.equal(analyticsWindow.ttwAnalytics.acquisitionSource,'organic_launch_list');
const analyticsPayload=analyticsWindow.ttwAnalytics.track('invite_sent',{count:2,event:'cannot_override'});
assert.equal(analyticsPayload.event,'invite_sent','Event details must not overwrite the named event.');
assert.equal(analyticsPayload.app_build,'runtime-audit-build');
assert.equal(analyticsPayload.browser_context,'browser');
assert.equal(analyticsPayload.$geoip_disable,true,'Named events must disable PostHog GeoIP enrichment.');
assert(analyticsWindow.posthog.some(call=>call[0]==='capture'&&call[1]==='invite_sent'),'The runtime dispatcher must enqueue PostHog captures.');
assert.equal(analyticsWindow.plausible.q.at(-1)[0],'invite_sent','The runtime dispatcher must preserve the Plausible conversion bridge.');
analyticsWindow.ttwAnalytics.identify('firebase-uid',{seasonId:'love-is-blind-us-10'});
const identifyCall=analyticsWindow.posthog.find(call=>call[0]==='identify');
assert.deepEqual(JSON.parse(JSON.stringify(identifyCall)),['identify','firebase-uid',{}, {acquisition_source:'organic_launch_list',first_seen_season:'love-is-blind-us-10'}]);
const posthogConfig=analyticsWindow.posthog._i[0][1];
const registrationCall=analyticsWindow.posthog.find(call=>call[0]==='register');
assert.equal(registrationCall[1].$geoip_disable,true,'Automatic PostHog events and feature-flag requests must disable GeoIP enrichment.');
assert.equal(posthogConfig.capture_pageview,false,'The app shell must disable PostHog automatic pageviews.');
assert.equal(posthogConfig.mask_personal_data_properties,true,'PostHog personal-data masking must be enabled.');
assert.deepEqual(Array.from(posthogConfig.custom_personal_data_properties),['join','signInEmail','oobCode','apiKey','continueUrl','mode','lang','tenantId']);
assert.equal(posthogConfig.session_recording.maskAllInputs,true,'Session replay must mask form input values.');
assert.equal(posthogConfig.session_recording.maskTextSelector,'*','Session replay must mask every rendered text node.');
assert.equal(posthogConfig.session_recording.maskAllElementAttributes,undefined,'Session replay must not pretend the unsupported maskAllElementAttributes option protects accessibility attributes; sensitive regions use ph-no-capture instead.');
const sanitizedEvent=posthogConfig.before_send({
  properties:{
    $current_url:'https://throughthewall.ca/?join=secret-token#/app/lobby',
    $referrer:'https://www.throughthewall.ca/sign-in?signInEmail=player@example.com&oobCode=secret',
    $initial_referrer:'https://throughthewall.ca/?join=initial-code',
    $session_entry_url:'https://throughthewall.ca/?join=session-code',
    $session_entry_referrer:'https://throughthewall.ca/?oobCode=session-secret',
    $prev_pageview_pathname:'/welcome/',
    $pathname:'/app/',
    $web_vitals_FCP_event:{$current_url:'https://throughthewall.ca/?signInEmail=player@example.com&oobCode=vitals-secret'},
    future_payload:{urls:['https://example.com/watch?join=pool.code',{target:'https://www.throughthewall.ca/deep/path/?oobCode=secret#results'}]},
  },
  $set:{$current_url:'https://throughthewall.ca/?join=set-code'},
  $set_once:{$initial_current_url:'https://throughthewall.ca/?join=first-code&signInEmail=player@example.com'},
});
assert.equal(sanitizedEvent.properties.$current_url,'https://throughthewall.ca/#/app/lobby','Hash routes must survive URL sanitization.');
assert.equal(sanitizedEvent.properties.$pathname,'/app/');
assert.equal(sanitizedEvent.properties.$prev_pageview_pathname,'/welcome/');
assert.equal(sanitizedEvent.properties.future_payload.urls[0],'https://example.com/watch');
assert.equal(sanitizedEvent.properties.future_payload.urls[1].target,'https://www.throughthewall.ca/deep/path/#results');
const sanitizedStrings=[];
const collectStrings=value=>{if(typeof value==='string')sanitizedStrings.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(collectStrings);};
collectStrings(sanitizedEvent);
for(const value of sanitizedStrings){
  assert(!value.includes('?'),'Sanitized PostHog event values must not retain URL query strings.');
  assert(!/join=|signInEmail|oobCode/.test(value),'Sanitized PostHog event values must not retain join or sign-in secrets.');
}
assert.equal(sanitizedEvent.properties.$geoip_disable,true,'Automatic SDK events and replay snapshots must disable GeoIP enrichment before sending.');
const replayEvent=posthogConfig.before_send({
  event:'$snapshot',
  properties:{$snapshot_data:[
    {type:4,data:{href:'https://throughthewall.ca/?join=replay-code#/app/lobby'}},
    {type:2,data:{node:{type:2,attributes:{href:'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap'}}}},
  ]},
});
assert.equal(replayEvent.properties.$snapshot_data[0].data.href,'https://throughthewall.ca/#/app/lobby','Replay page addresses must lose query strings without losing hash routes.');
assert.equal(replayEvent.properties.$snapshot_data[1].data.node.attributes.href,'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap','Replay asset URLs must keep query strings needed to reproduce the page.');
assert.equal(replayEvent.properties.$geoip_disable,true,'Replay snapshots must continue to disable GeoIP enrichment.');
assert(html.includes("browserContext='instagram_in_app'")&&html.includes("browserContext='messenger_in_app'")&&html.includes("browserContext='tiktok_in_app'"),'Arrival telemetry must distinguish common in-app browsers.');
assert(html.includes("reportTtwError('startup_failed',error,{operation:'complete_auth_redirect'})"),'Unresolved auth returns must emit the bounded startup failure diagnostic.');
assert(html.includes('const hasAuthReturn=window._fb.hasAuthRedirectParams()||window._fb.hasPendingAuthRedirect();'),'Startup diagnostics must retain redirect intent after Firebase removes its handler parameters.');
assert(html.includes("else if((hadPendingRedirect||hasAuthRedirectParams())&&!auth.currentUser)"),'A returned redirect with no resolved user must fail loudly even after handler parameters are removed.');
assert(!html.includes('userAgent,...details'),'Telemetry must not send the raw browser user agent.');
assert(html.includes("localStorage.getItem('through-the-wall-email-signin')||emailFromSignInUrl(window.location.href)||window.prompt"),'Cross-device email sign-in must use URL state before prompting.');
assert(html.includes('Open the sign-in link on any device to continue.'),'Email sign-in copy must describe cross-device support.');
assert(!html.includes("setErr(e?.message||'Google sign-in"),'Google auth errors must use the friendly mapper.');
assert(!html.includes('Sign in with Apple'),'Apple sign-in must stay hidden until its developer credentials are configured.');
assert(!html.includes("OAuthProvider('apple.com')"),'Unconfigured Apple authentication code must not ship.');
assert(!html.includes("setErr(e?.message||'The sign-in link"),'Email auth errors must use the friendly mapper.');
assert(!html.includes("setErr(e?.message||'You could not be signed out"),'Sign-out errors must use the friendly mapper.');
assert.equal(packageJson.devDependencies.react,'18.2.0');
assert.equal(packageJson.devDependencies['react-dom'],'18.2.0');
assert.equal(packageJson.devDependencies['playwright-chromium'],'1.62.1');
assert.equal(packageJson.scripts.check,'npm run doctor && npm test && npm run build && npm run test:smoke','The release gate must verify the toolchain and smoke-test the production build.');
assert(packageJson.scripts['test:rules'].includes('scripts/run-with-java.js'),'Firestore emulator tests must discover the pinned Java 21 runtime consistently.');
assert(builtAppSmoke.includes("require('./toolchain')"),'The browser smoke test must use the shared browser resolver.');
assert(builtAppSmoke.includes("process.env.SMOKE_DIST_DIR||path.join(root,'dist')"),'The browser smoke test must serve built output, not source.');
assert(builtAppSmoke.includes("{pathname:'/',react:true")&&builtAppSmoke.includes("{pathname:'/?join=smoke-pool.smoke-code',react:true")&&builtAppSmoke.includes("{pathname:'/welcome/',react:false"),'The browser smoke test must cover the signed-out, invite, and welcome routes.');
assert(builtAppSmoke.includes("path.join(dist,'seasons')"),'The browser smoke test must cover a generated season page.');
assert(builtAppSmoke.includes("page.locator('#root .fatal-app').count()")&&builtAppSmoke.includes("page.locator('#root .root-boot[role=\"alert\"]').count()"),'The browser smoke test must reject both render-boundary and pre-mount fallbacks.');
assert(builtAppSmoke.includes("texts:['Getting the pods ready…','Ready to start your season?']"),'The signed-out smoke test must tolerate Firebase Auth still checking.');
assert(builtAppSmoke.includes("message.type()==='error'")&&builtAppSmoke.includes("page.on('pageerror'")&&builtAppSmoke.includes("window.addEventListener('unhandledrejection'"),'The browser smoke test must fail on console errors, page errors, and unhandled rejections.');
assert(buildSource.includes("'node_modules','react','umd','react.production.min.js'"),'The production build must self-host React.');
assert(buildSource.includes("'node_modules','react-dom','umd','react-dom.production.min.js'"),'The production build must self-host ReactDOM.');
assert(!html.includes("from 'https://www.gstatic.com/firebasejs/"),'Firebase modules must load from the same-origin Hosting SDK path so content blockers cannot prevent startup.');
for(const moduleName of ['app','app-check','auth','firestore','functions']) {
  assert(html.includes(`from '/__/firebase/11.2.0/firebase-${moduleName}.js'`),`The ${moduleName} Firebase module must use the versioned same-origin Hosting SDK path.`);
}
assert(html.includes('"https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js":"/__/firebase/11.2.0/firebase-app.js"'),'The Firebase import map must keep the Hosting SDK modules on one shared app module instance.');
assert(!productionCsp.includes('https://cdnjs.cloudflare.com'),'The production CSP must not allow the former React CDN.');
assert(productionCsp.includes("script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com"),'The production CSP must allow the Firebase Auth Google API script.');
assert(productionCsp.includes("frame-src 'self' https://accounts.google.com"),'The production CSP must allow same-origin Firebase Auth handlers.');
assert(productionCsp.includes('https://eu-assets.i.posthog.com'),'The production CSP must allow the disclosed PostHog EU asset host.');
assert(productionCsp.includes('https://eu.i.posthog.com'),'The production CSP must allow the disclosed PostHog EU ingestion host.');
assert(productionCsp.includes("worker-src 'self' blob:"),'The production CSP must allow PostHog replay workers.');
assert(!productionCsp.includes('https://appleid.apple.com'),'The production CSP must not allow the disabled Apple provider.');
assert(firebaseConfig.includes('// Apple sign-in: restore https://appleid.apple.com to frame-src before re-enabling the provider.'),'The Hosting config must preserve the Apple CSP re-enable warning beside frame-src.');
assert(firebaseConfig.includes('"source": "/"')&&firebaseConfig.includes('"source": "**/*.html"'),'The app shell and direct HTML pages must have explicit cache rules.');
assert(firebaseConfig.match(/"Cache-Control", "value": "no-cache, no-store, must-revalidate"/g)?.length===3,'The app shell, HTML pages, and service-worker kill switch must revalidate after every deployment.');
assert(firebaseConfig.includes('"source": "/sw.js"'),'The service-worker kill switch must have its own no-cache Hosting rule.');
assert(firebaseConfig.includes('"source": "/assets/**"')&&firebaseConfig.includes('public, max-age=31536000, immutable'),'Hashed static assets must retain long-lived caching.');

assert(workflow.includes('actions/checkout@v6'));
assert(workflow.includes('actions/setup-node@v6'));
assert(workflow.includes('actions/setup-java@v5'));
assert(workflow.includes('actions/cache@v5')&&workflow.includes('path: ~/.cache/ms-playwright'),'The verify job must cache Playwright browser binaries.');
assert(workflow.includes('npx playwright install --with-deps chromium'),'The verify job must install Chromium and its Linux dependencies explicitly.');
assert(workflow.includes('google-github-actions/auth@v3'));
assert(workflow.includes('workload_identity_provider: projects/737647208245/locations/global/workloadIdentityPools/github-actions/providers/libapp'));
assert(workflow.includes('service_account: github-firebase-hosting@lib-oauth.iam.gserviceaccount.com'));
assert(!workflow.includes('credentials_json'),'The release workflow must use short-lived Workload Identity credentials.');
assert(!workflow.includes('FIREBASE_SERVICE_ACCOUNT_LIB_OAUTH'),'The release workflow must not require a persistent service-account key.');
assert(workflow.includes('git diff --quiet "$BEFORE_SHA" "$GITHUB_SHA" -- firestore.rules firestore.indexes.json firebase.json functions'),'Backend changes must hold an automatic Hosting release.');
assert(workflow.includes('git cat-file -e "$BEFORE_SHA^{commit}"'),'The release gate must detect a missing shallow-clone baseline before comparing files.');
assert(workflow.includes('hold_reason=comparison_unavailable')&&workflow.includes('hold_reason=backend_changed')&&workflow.includes('hold_reason=comparison_failed'),'The release gate must distinguish changed files from unavailable or failed comparisons.');
assert(workflow.includes('>> "$GITHUB_STEP_SUMMARY"'),'A held release must explain itself in the GitHub step summary.');
assert(workflow.includes('echo "::error title=Hosting release held::$hold_message"')&&workflow.includes('exit 1'),'A held release must fail rather than report a false green deployment.');
assert(workflow.includes('backend_deployed'),'A manual Hosting release must explicitly confirm the backend is deployed.');
assert(workflow.includes('POSTHOG_KEY: ${{ vars.POSTHOG_PROJECT_TOKEN }}')&&workflow.includes('REQUIRE_POSTHOG_CONFIG: true'),'Production deploys must inject and require the public PostHog project token.');
assert(workflow.includes('name: Test exact release build')&&workflow.includes('run: npm run test:smoke'),'The exact production-configured build must pass the browser smoke test before deployment.');
assert(workflow.includes("if: github.event_name == 'workflow_dispatch' && inputs.backend_deployed == true\n        run: npm run verify:live-rules"),'A confirmed manual release must compare the published Firestore rules before Hosting deploys.');
assert(workflow.includes('id-token: write'),'The verification job must be able to request a short-lived identity for the live-rules check.');
assert(liveRulesVerifier.includes('/releases/cloud.firestore'),'The live-rules check must resolve the published Firestore release.');
assert(liveRulesVerifier.includes("scopes:['https://www.googleapis.com/auth/cloud-platform']"),'The Firebase Rules API requires the cloud-platform OAuth scope; IAM remains the permission boundary.');
assert(!liveRulesVerifier.includes('cloud-platform.read-only'),'The unsupported read-only OAuth scope must not silently block live-rules verification.');
assert(liveRulesVerifier.includes('release.rulesetName'),'The live-rules check must fetch the exact released ruleset.');
assert(liveRulesVerifier.includes("createHash('sha256')")&&liveRulesVerifier.includes('if(localHash!==liveHash)'),'The live-rules check must fail on content drift.');
assert(workflow.includes("if: steps.backend_changes.outputs.hold_hosting != 'true'\n        run: npx firebase deploy --only hosting"),'Hosting must remain gated by the backend-deployment check.');
assert(!workflow.includes('actions/deploy-pages'),'The release workflow must not deploy to GitHub Pages.');
assert(runbook.includes('rollbackSeasonSnapshot'));
assert(runbook.includes('clientErrors/{userId}/categories/{category}'),'The launch runbook must direct operators to the Firestore client diagnostics.');
assert(runbook.includes('Do not use `jsonPayload.message="Client operation failed"`'),'The runbook must explain that the former Cloud Logging query cannot find browser-written diagnostics.');

async function assertMirrorEntryRegression(){
  const helperStart=html.indexOf('/* MIRROR ENTRY HELPERS START */');
  const helperEnd=html.indexOf('/* MIRROR ENTRY HELPERS END */');
  const gateStart=html.indexOf('/* EPISODE GATE HELPERS START */');
  const gateEnd=html.indexOf('/* EPISODE GATE HELPERS END */');
  assert(helperStart>=0&&helperEnd>helperStart,'Mirrored-entry helpers must remain independently testable.');
  const context={Promise,window:{},PH_ORDER:['pods','dating','weddings','reunion']};
  vm.createContext(context);
  vm.runInContext(`${html.slice(helperStart,helperEnd)}\n${html.slice(gateStart,gateEnd)}\nthis.__syncMirroredPicksOnEntry=syncMirroredPicksOnEntry;this.__syncMirroredTargetProgress=syncMirroredTargetProgress;this.__syncMirroredPhaseCompletion=syncMirroredPhaseCompletion;this.__loadMirrorSourceState=loadMirrorSourceState;this.__linkedMirrorPeers=linkedMirrorPeers;this.__staleMirrorSourceError=staleMirrorSourceError;this.__friendSafeMirroredPicks=friendSafeMirroredPicks;this.__mergeMirroredCheckpointState=mergeMirroredCheckpointState;`,context);
  assert.equal(context.__staleMirrorSourceError({code:'permission-denied'}),false);
  assert.equal(context.__staleMirrorSourceError({message:'Missing or insufficient permissions.'}),false);
  assert.equal(context.__staleMirrorSourceError({code:'not-found'}),true);
  assert.equal(context.__staleMirrorSourceError({code:'unavailable'}),false);
  const mirrorReads=[];
  const emptySource=await context.__loadMirrorSourceState({
    poolId:'fresh-friend',uid:'viewer',
    loadMyPlayer:async(poolId,uid)=>{mirrorReads.push(['player',poolId,uid]);return null;},
    getPhaseStatus:async(poolId,phase)=>{mirrorReads.push(['status',poolId,phase]);return phase==='pods'?{completedMembers:['viewer']}:null;},
    getPool:async()=>({id:'fresh-friend',members:['viewer']}),
  });
  assert.equal(emptySource.player,null);
  assert.equal(emptySource.empty,true,'A newly created pool without a player document must remain a valid mirror source.');
  assert.deepEqual(mirrorReads,[
    ['player','fresh-friend','viewer'],
    ['status','fresh-friend','pods'],
    ['status','fresh-friend','dating'],
    ['status','fresh-friend','weddings'],
    ['status','fresh-friend','reunion'],
  ],'Mirror entry must read only the current player and four phase-status documents, never a player collection.');
  assert.deepEqual(emptySource.status.pods,{completedMembers:['viewer']});
  await assert.rejects(()=>context.__loadMirrorSourceState({
    poolId:'read-blocked',uid:'viewer',
    loadMyPlayer:async()=>{throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});},
    getPhaseStatus:async()=>null,
    getPool:async()=>({id:'read-blocked',members:['viewer']}),
  }),error=>error.code==='permission-denied','A readable source pool must not be detached merely because one child read was denied.');
  await assert.rejects(()=>context.__loadMirrorSourceState({
    poolId:'deleted-source',uid:'viewer',
    loadMyPlayer:async()=>null,
    getPhaseStatus:async()=>null,
    getPool:async()=>null,
  }),error=>error.code==='not-found','A genuinely deleted source must still detach cleanly.');
  assert.equal(
    JSON.stringify(context.__linkedMirrorPeers([{poolId:'global',sourcePoolId:'friend'}],'friend')),
    JSON.stringify([{poolId:'global'}]),
    'Saving the source pool must synchronize its linked target.',
  );
  assert.equal(
    JSON.stringify(context.__linkedMirrorPeers([{poolId:'global',sourcePoolId:'friend'}],'global')),
    JSON.stringify([{poolId:'friend'}]),
    'Saving the target pool must synchronize back to its source.',
  );
  const attempted=[],skipped=[];
  await context.__syncMirroredPicksOnEntry({
    phases:['pods','reunion'],
    savePhasePicks:async phase=>{attempted.push(phase);if(phase==='reunion')throw Object.assign(new Error('locked'),{code:'permission-denied'});},
    onSkipped:(phase,error)=>skipped.push([phase,error.code]),
  });
  assert.deepEqual(attempted,['pods','reunion']);
  assert.deepEqual(skipped,[['reunion','permission-denied']]);
  const progressCalls=[];
  const sourceState={phase:'pods',screen:'watch',w:1,watchThrough:13,completed:{}};
  const spans={pods:{endEp:6},dating:{endEp:8},weddings:{endEp:10},reunion:{endEp:13}};
  const progressResult=await context.__syncMirroredTargetProgress({
    poolId:'global__season',uid:'viewer',sourceState,spans,availableThrough:13,globalTarget:true,
    advanceGlobalWatch:async(...args)=>{progressCalls.push(['trusted',...args]);return {data:{watchedThrough:1}};},
    syncPublicProgress:async(...args)=>{progressCalls.push(['public',...args]);return sourceState;},
  });
  assert.deepEqual(progressCalls,[
    ['trusted','global__season',1],
    ['public','global__season','viewer',sourceState,spans,13],
  ],'A friend-linked Global Pool must advance the trusted ledger to confirmed w, never the larger watchThrough intent, before reflecting public progress.');
  assert.deepEqual(progressResult,sourceState);
  const friendProgressCalls=[];
  await context.__syncMirroredTargetProgress({
    poolId:'friend',uid:'viewer',sourceState:{...sourceState,w:4,watchThrough:4},spans,availableThrough:11,globalTarget:false,
    advanceGlobalWatch:async()=>friendProgressCalls.push('trusted'),
    syncPublicProgress:async(...args)=>{friendProgressCalls.push(['public',...args]);return {w:4,watchThrough:4};},
  });
  assert.equal(friendProgressCalls.length,1,'A Global-linked private pool must receive public progress without calling the Global ledger.');
  assert.deepEqual(friendProgressCalls[0].slice(0,3),['public','friend','viewer']);
  const intentOnly=context.__mergeMirroredCheckpointState(
    {phase:'pods',screen:'board',w:0,watchThrough:0,completed:{}},sourceState,spans,13,
  );
  assert.equal(intentOnly.w,1,'Public mirror state must keep confirmed w separate from a larger watchThrough intent.');
  assert.equal(intentOnly.watchThrough,6,'Public mirror state may retain the valid phase-end intent target.');
  const safeFriendPicks=context.__friendSafeMirroredPicks('pods',[
    {c:'Alex|Casey',s:20,w:9,lockedAt:123,releasedThroughAtLock:11},
  ],[{c:'Casey|Alex',s:10,w:2}],5);
  assert.equal(safeFriendPicks[0].w,2,'Mirroring into a private pool must preserve the matching private pick window.');
  assert.equal('lockedAt' in safeFriendPicks[0],false);
  assert.equal('releasedThroughAtLock' in safeFriendPicks[0],false);
  const forward=context.__mergeMirroredCheckpointState(
    {phase:'pods',screen:'board',w:3,watchThrough:3,completed:{}},
    {phase:'dating',screen:'watch',w:8,watchThrough:8,completed:{pods:true}},spans,11,
  );
  assert.equal(JSON.stringify(forward),JSON.stringify({phase:'dating',screen:'watch',w:8,watchThrough:8,completed:{pods:true}}),'A reverse push must move phase, screen, and completion forward when the source leads.');
  const clamped=context.__mergeMirroredCheckpointState(
    {phase:'pods',screen:'board',w:3,watchThrough:3,completed:{}},
    {phase:'dating',screen:'watch',w:8,watchThrough:8,completed:{}},spans,11,
  );
  assert.equal(clamped.phase,'pods');
  assert.equal(clamped.w,6,'A live reverse push must clamp against the target pool current phase span.');
  const backward=context.__mergeMirroredCheckpointState(
    {phase:'dating',screen:'close',w:8,watchThrough:8,completed:{pods:true,dating:true}},
    {phase:'pods',screen:'intro',w:1,watchThrough:1,completed:{}},spans,11,
  );
  assert.equal(JSON.stringify(backward),JSON.stringify({phase:'dating',screen:'close',w:8,watchThrough:8,completed:{pods:true,dating:true}}),'Mirror reconciliation must never move checkpoint state backward.');
  const completionCalls=[];
  await context.__syncMirroredPhaseCompletion({
    poolId:'global__season',uid:'viewer',phase:'pods',picks:[{c:'Alex|Casey',s:20}],globalTarget:true,confirmedWatch:6,
    lockGlobalPicks:async()=>{completionCalls.push('lock');return {data:{accepted:{pods:1}}};},
    completeGlobalPhase:async()=>completionCalls.push('complete-global'),
    completeFriendPhase:async()=>completionCalls.push('complete-friend'),
    syncPublicCompletion:async()=>completionCalls.push('public'),
  });
  assert.deepEqual(completionCalls,['lock','complete-global'],'A linked Global checkpoint must trusted-lock its picks before completing.');
  const friendCompletionCalls=[];
  await context.__syncMirroredPhaseCompletion({
    poolId:'friend',uid:'viewer',phase:'pods',picks:[],globalTarget:false,confirmedWatch:6,
    lockGlobalPicks:async()=>friendCompletionCalls.push('lock'),
    completeGlobalPhase:async()=>friendCompletionCalls.push('complete-global'),
    completeFriendPhase:async(...args)=>friendCompletionCalls.push(['complete-friend',...args]),
    syncPublicCompletion:async(...args)=>friendCompletionCalls.push(['public',...args]),
  });
  assert.deepEqual(friendCompletionCalls,[
    ['complete-friend','friend','pods','viewer'],
    ['public','friend','viewer','pods',6],
  ],'A linked friend checkpoint must register completion before closing its public player state.');
  assert(html.includes("linkMirrorPeers: async (poolId,peerPoolId,uid)"),'A linked pair must be written to both player documents.');
  assert(html.includes("clearMirrorSource: async (poolId,uid,peerPoolId='')"),'A stale mirror source must be removable symmetrically without deleting copied game state.');
  assert(html.includes("const linkedPeer=linkedMirrorPeers(pickMirrorLinks.current,enteredPool.id)[0]"),'Entry reconciliation must resolve a peer no matter which linked pool is opened.');
  assert(html.includes('Your copied Global picks and progress were kept'),'A repaired Global Pool must explain that its copied state was preserved.');
  assert(html.includes('pending.data.screen===\'watch\''),'A source prediction window must trusted-lock its linked Global copy before progress advances.');
  const linkedSaveStart=html.indexOf('const linkedTargets=linkedMirrorPeers(pickMirrorLinks.current,pending.poolId)');
  const linkedTrustedLock=html.indexOf('const lockResult=await window._fb.lockGlobalPicks(link.poolId,submitted);',linkedSaveStart);
  const linkedProgress=html.indexOf('await syncMirroredTargetProgress({',linkedTrustedLock);
  assert(linkedSaveStart>=0&&linkedTrustedLock>linkedSaveStart&&linkedProgress>linkedTrustedLock,'A mirrored Global prediction must trusted-lock before its watch ledger advances.');
  assert(functionsSource.includes('credited:Object.fromEntries'),'Global locks must return the server-credited prediction windows to the client.');
  assert(functionsSource.includes("poolRef.collection('phasePicks').doc(`${phase}__${uid}`)"),'The trusted Global lock must publish credited picks for accurate receipts after reload.');
  assert(functionsSource.includes("action==='resetHistoricalSimulation'"),'The controlled historical Global reset must remain an explicit callable action.');
  assert(functionsSource.includes("action==='relaxHistoricalJoinFloor'"),'Historical scoring repair must remain an explicit callable action.');
  assert(functionsSource.includes('GLOBAL_POOL_ADMINS.has(email)'),'Historical Global reset must remain administrator-only.');
  assert(functionsSource.includes('cfg.AVAILABLE_THROUGH_EP<seasonEnd'),'Historical reset must refuse a live or partially released season.');
  const historicalResetStart=functionsSource.indexOf('async function resetHistoricalGlobalSimulation(request)');
  const historicalResetEnd=functionsSource.indexOf('exports.recomputeGlobalStandingsOnSeasonUpdate',historicalResetStart);
  const historicalResetSource=functionsSource.slice(historicalResetStart,historicalResetEnd);
  assert(historicalResetStart>=0&&historicalResetEnd>historicalResetStart,'The historical reset implementation must remain auditable.');
  assert(!historicalResetSource.includes('duplicateFromPoolId:FieldValue.delete()'),'Historical reset must preserve established private-pool links.');
  assert(historicalResetSource.includes('linksPreserved'),'Historical reset must report how many Global-to-friend links survived.');
  assert(historicalResetSource.includes('linkedPlayersReset'),'Historical reset must report how many linked friend-player states were cleared.');
  assert(historicalResetSource.includes('completedMembers:FieldValue.arrayRemove(...uids)'),'Historical reset must prevent old linked completions from replaying into Global.');
  assert(historicalResetSource.includes("sourcePoolRef.collection('phasePicks').doc(`${phase}__${uid}`)"),'Historical reset must clear the linked tester picks that would otherwise replay into Global.');
  assert(html.includes('sync links are preserved'),'The reset confirmation must explain that linked pools stay connected.');
  assert(html.includes('Other private-pool members and settings are not changed'),'The reset confirmation must define the linked private-pool blast radius.');
  const historicalRepairStart=functionsSource.indexOf('async function relaxHistoricalJoinFloor(request)');
  const historicalRepairSource=functionsSource.slice(historicalRepairStart,historicalResetEnd);
  assert(historicalRepairStart>=0,'The historical scoring repair implementation must remain auditable.');
  assert(historicalRepairSource.includes('const confirmedSource=linkedPlayer?.data||publicPlayer?.data||{};'),'A linked friend player must be the canonical confirmed-watch source for repair.');
  assert(historicalRepairSource.includes('watchedThrough:confirmedWatch'),'The admin repair must replace a contaminated trusted watch ledger with confirmed progress.');
  assert(historicalRepairSource.includes("batch.set(publicPlayer.ref,{w:confirmedWatch},{merge:true})"),'The admin repair must also correct a contaminated public Global w.');
  assert(historicalRepairSource.includes('linkedPicksRestamped'),'The admin repair must report credited pick repairs in linked private pools.');
  assert(!historicalRepairSource.includes('cfg.AVAILABLE_THROUGH_EP<seasonEnd'),'The confirmed-watch repair must be permitted while a season is live.');
  assert(html.includes('This repair is safe while a season is live.'),'The admin UI must describe the live-season repair precondition accurately.');
}

async function assertBoundedStandingsListener(){
  const helperStart=html.indexOf('/* BOUNDED STANDINGS LISTENER START */');
  const helperEnd=html.indexOf('/* BOUNDED STANDINGS LISTENER END */');
  assert(helperStart>=0&&helperEnd>helperStart,'The bounded Global standings listener must remain independently executable.');
  const context={};
  vm.createContext(context);
  vm.runInContext(`${html.slice(helperStart,helperEnd)}\nthis.__createBoundedStandingsListener=createBoundedStandingsListener;`,context);
  let time=10000,visibilityHandler=null,loadCount=0,subscribeCount=0,stopCount=0;
  const renders=[],timers=[];
  const visibility={
    visibilityState:'visible',
    addEventListener:(_name,handler)=>{visibilityHandler=handler;},
    removeEventListener:(_name,handler)=>{if(visibilityHandler===handler)visibilityHandler=null;},
  };
  const subscribers=[];
  const stop=context.__createBoundedStandingsListener({
    reference:'standings/current',visibility,now:()=>time,
    subscribe:(_reference,onValue)=>{
      subscribeCount++;subscribers.push(onValue);
      return ()=>{stopCount++;};
    },
    load:async()=>{loadCount++;return {exists:()=>true,data:()=>({revision:'resume'})};},
    onChange:value=>renders.push(value),
    schedule:(callback,delay)=>{const timer={callback,delay,cancelled:false};timers.push(timer);return timer;},
    cancel:timer=>{if(timer)timer.cancelled=true;},
  });
  assert.equal(subscribeCount,1);
  subscribers[0]({exists:()=>true,data:()=>({revision:1})});
  timers.at(-1).callback();
  assert.deepEqual(renders,[{revision:1}]);
  time=11000;subscribers[0]({exists:()=>true,data:()=>({revision:2})});
  assert.equal(timers.at(-1).delay,4000);
  time=12000;subscribers[0]({exists:()=>true,data:()=>({revision:3})});
  assert.equal(timers.at(-1).delay,3000);
  time=15000;timers.at(-1).callback();
  assert.deepEqual(renders,[{revision:1},{revision:3}],'Rapid snapshot writes must collapse into at most one render per five seconds.');
  visibility.visibilityState='hidden';
  await visibilityHandler();
  assert.equal(stopCount,1,'The Firestore listener must stop while the tab is hidden.');
  visibility.visibilityState='visible';
  await visibilityHandler();
  assert.equal(loadCount,1,'Returning to the tab must perform exactly one current-standings load.');
  assert.equal(subscribeCount,2,'The live listener must resume after the single catch-up load.');
  assert.deepEqual(renders.at(-1),{revision:'resume'});
  subscribers[1]({exists:()=>true,data:()=>({revision:'duplicate-initial'})});
  assert.deepEqual(renders.at(-1),{revision:'resume'},'The resumed listener must skip its duplicate initial snapshot.');
  stop();
  assert.equal(stopCount,2);
  assert.equal(visibilityHandler,null);
}

async function assertSeasonCatalogLoader(){
  const helperStart=html.indexOf('/* SEASON CATALOG LOADER START */');
  const helperEnd=html.indexOf('/* SEASON CATALOG LOADER END */');
  assert(helperStart>=0&&helperEnd>helperStart,'The compact season catalog loader must remain independently executable.');
  const context={console:{info:()=>{}}};
  vm.createContext(context);
  vm.runInContext(`${html.slice(helperStart,helperEnd)}\nthis.__loadPublishedSeasonCatalog=loadPublishedSeasonCatalog;`,context);
  let collectionReads=0;
  const compact=await context.__loadPublishedSeasonCatalog({
    loadCatalog:async()=>({seasons:[{id:'love-is-blind-us-11',status:'upcoming'}]}),
    listSeasons:async()=>{collectionReads++;return [];},
  });
  assert.equal(JSON.stringify(compact),JSON.stringify([{id:'love-is-blind-us-11',status:'upcoming'}]));
  assert.equal(collectionReads,0,'A present catalog must prevent the browser from downloading every season snapshot.');
  const fallback=await context.__loadPublishedSeasonCatalog({
    loadCatalog:async()=>null,
    listSeasons:async()=>{collectionReads++;return [{id:'legacy-season',Settings:[]}];},
  });
  assert.equal(JSON.stringify(fallback),JSON.stringify([{id:'legacy-season',Settings:[]}]));
  assert.equal(collectionReads,1,'A missing catalog must retain the safe pre-rules collection fallback.');
  const deniedFallback=await context.__loadPublishedSeasonCatalog({
    loadCatalog:async()=>{throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});},
    listSeasons:async()=>{collectionReads++;return [{id:'pre-rule-season'}];},
  });
  assert.equal(JSON.stringify(deniedFallback),JSON.stringify([{id:'pre-rule-season'}]));
  assert.equal(collectionReads,2,'Batch A must remain compatible before Batch C grants the catalog read rule.');
}

async function assertPersonalGlobalStandingRow(){
  const start=html.indexOf('const globalStandingsView =');
  const end=html.indexOf('\nconst globalOwnerOverrides',start);
  assert(start>=0&&end>start,'The Global standings view must remain independently executable.');
  const context={PH_ORDER:['pods','dating','weddings','reunion'],freshPicks:()=>({pods:[],dating:[],weddings:[],reunion:[]})};
  vm.createContext(context);
  vm.runInContext(`${html.slice(start,end)}\nthis.__globalStandingsView=globalStandingsView;`,context);
  const topRows=Array.from({length:500},(_,index)=>({uid:`top-${index}`,username:`Top ${index}`,rank:index+1,total:1000-index,completedPhases:['pods'],phaseScores:{pods:1000-index}}));
  const ownRow={uid:'viewer',username:'Viewer',rank:777,total:12,completedPhases:['pods'],phaseScores:{pods:12}};
  const ownPlayer={username:'Viewer',picks:{pods:[{c:'A|B',s:10,w:1}],dating:[],weddings:[],reunion:[]},completed:{pods:true}};
  const view=context.__globalStandingsView({rows:topRows,computedAt:123},'viewer',ownPlayer,ownRow);
  assert.equal(view.players.viewer,ownPlayer,'A viewer outside the top 500 must keep their real player state.');
  assert.equal(view.phaseScores.pods.viewer,12,'A viewer outside the top 500 must receive their trusted personal score row.');
  assert(view.status.pods.completedMembers.includes('viewer'));
}

Promise.all([assertMirrorEntryRegression(),assertBoundedStandingsListener(),assertSeasonCatalogLoader(),assertPersonalGlobalStandingRow()]).then(()=>console.log('Live-operations audit assertions passed.')).catch(error=>{console.error(error);process.exitCode=1;});
