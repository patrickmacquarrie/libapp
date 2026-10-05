const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','analytics.js'),'utf8')
  .replaceAll('__POSTHOG_PROJECT_TOKEN__','phc_privacy_test_token')
  .replaceAll('__POSTHOG_HOST__','https://eu.i.posthog.com')
  .replaceAll('__META_PIXEL_ID__','1419228339585181')
  .replaceAll('__APP_BUILD_TIMESTAMP__','privacy-test-build');

function load({hostname='throughthewall.ca',search='',optedOut=false,storage:existingStorage}={}){
  const storage=existingStorage||new Map(optedOut?[['through-the-wall-analytics-opt-out','1']]:[]),listeners=new Map();
  class CustomEvent{constructor(type,options={}){this.type=type;this.detail=options.detail;}}
  const window={
    location:{hostname,origin:`https://${hostname}`,pathname:'/',search,hash:''},
    addEventListener:(type,listener)=>listeners.set(type,listener),
    dispatchEvent:event=>{listeners.get(event.type)?.(event);return true;},
  };
  const document={referrer:'',createElement:()=>({}),getElementsByTagName:()=>[{parentNode:{insertBefore:()=>{}}}]};
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
  vm.runInNewContext(source,{window,document,localStorage,URL,URLSearchParams,Date,Object,String,CustomEvent});
  return {window,storage};
}

const optedOut=load({optedOut:true});
assert.equal(optedOut.window.posthog,undefined);
assert.equal(optedOut.window.ttwAnalytics.enabled,false);
optedOut.window.ttwAnalytics.track('should_not_capture');
assert.equal(optedOut.window.dataLayer,undefined);
let variant='unset';optedOut.window.ttwAnalytics.onPriceVariant(value=>{variant=value;});
assert.equal(variant,null);
assert.equal(optedOut.storage.get('plausible_ignore'),'true');

const local=load({hostname:'127.0.0.1'});
assert.equal(local.window.posthog,undefined);
assert.equal(local.window.ttwAnalytics.enabled,false);

const production=load();
assert.equal(production.window.ttwAnalytics.enabled,true);
assert.equal(production.window.posthog._i.length,1);
assert.equal(production.window.fbq,undefined,'Meta must not load before a separate advertising choice.');
production.window.ttwAnalytics.metaOptIn();
assert(production.window.fbq.queue.some(call=>call[0]==='track'&&call[1]==='PageView'));
production.window.ttwAnalytics.track('account_created');
production.window.ttwAnalytics.track('pool_created');
production.window.ttwAnalytics.track('global_pool_joined');
assert(production.window.fbq.queue.some(call=>call[0]==='track'&&call[1]==='CompleteRegistration'));
assert(production.window.fbq.queue.some(call=>call[0]==='trackCustom'&&call[1]==='PoolCreated'));
assert(production.window.fbq.queue.some(call=>call[0]==='trackCustom'&&call[1]==='PoolJoined'));
production.window.ttwAnalytics.optOut();
const metaCallsWhenStopped=production.window.fbq.queue.length;
production.window.ttwAnalytics.metaOptIn();
assert.equal(production.window.fbq.queue.length,metaCallsWhenStopped,'Advertising opt-in must not resume a stopped analytics session.');
production.window.ttwAnalytics.optIn();
assert(production.window.fbq.queue.some(call=>call[0]==='consent'&&call[1]==='grant'));
production.window.ttwAnalytics.metaOptOut();
assert(production.window.fbq.queue.some(call=>call[0]==='consent'&&call[1]==='revoke'));
production.window.ttwAnalytics.optOut();
assert.equal(production.storage.get('through-the-wall-analytics-opt-out'),'1');
production.window.ttwAnalytics.optIn();
assert.equal(production.storage.has('through-the-wall-analytics-opt-out'),false);

const sensitivePage=load({search:'?join=pool.private-token'});
sensitivePage.window.ttwAnalytics.metaOptIn();
sensitivePage.window.ttwAnalytics.track('account_created');
assert.equal(sensitivePage.window.fbq,undefined,'Meta must not load on a URL containing invitation details.');
const unknownParameterPage=load({search:'?private_token=secret'});
unknownParameterPage.window.ttwAnalytics.metaOptIn();
assert.equal(unknownParameterPage.window.fbq,undefined,'Meta must not load when a URL includes an unrecognized parameter.');

const reloadStorage=new Map();
const beforeOptOut=load({storage:reloadStorage});
beforeOptOut.window.ttwAnalytics.optOut();
const optedOutReload=load({storage:reloadStorage});
assert.equal(optedOutReload.window.posthog,undefined,'PostHog must remain unloaded after reloading while opted out.');
optedOutReload.window.ttwAnalytics.optIn();
assert.equal(reloadStorage.has('through-the-wall-analytics-opt-out'),false,'Opting back in must clear the app opt-out flag.');
assert.equal(reloadStorage.get('through-the-wall-analytics-opt-in-pending'),'1','Opting in without a loaded SDK must schedule provider consent restoration.');
const restoredReload=load({storage:reloadStorage});
assert.equal(restoredReload.window.ttwAnalytics.enabled,true,'The next production load must re-enable analytics.');
assert(restoredReload.window.posthog.some(call=>call[0]==='opt_in_capturing'),'The next production load must clear PostHog’s persisted opt-out.');
assert.equal(reloadStorage.has('through-the-wall-analytics-opt-in-pending'),false,'Provider consent restoration must be consumed once.');
restoredReload.window.ttwAnalytics.track('capture_after_opt_in');
assert(restoredReload.window.posthog.some(call=>call[0]==='capture'&&call[1]==='capture_after_opt_in'),'Capture must resume after the opt-out, reload, opt-in, reload sequence.');

const legacyStuck=load();
const legacyConfig=legacyStuck.window.posthog._i[0][1];
let legacyOptInCalls=0;
legacyConfig.loaded({has_opted_out_capturing:()=>true,opt_in_capturing:()=>{legacyOptInCalls+=1;}});
assert.equal(legacyOptInCalls,1,'A browser stuck in PostHog’s legacy provider opt-out must be repaired when the SDK loads.');

const alreadyEnabled=load();
const enabledConfig=alreadyEnabled.window.posthog._i[0][1];
let unnecessaryOptInCalls=0;
enabledConfig.loaded({has_opted_out_capturing:()=>false,opt_in_capturing:()=>{unnecessaryOptInCalls+=1;}});
assert.equal(unnecessaryOptInCalls,0,'An already-enabled browser must not emit a redundant provider opt-in.');
console.log('Analytics production-host and opt-out assertions passed.');
