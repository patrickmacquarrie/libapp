const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','analytics.js'),'utf8')
  .replaceAll('__POSTHOG_PROJECT_TOKEN__','phc_privacy_test_token')
  .replaceAll('__POSTHOG_HOST__','https://eu.i.posthog.com')
  .replaceAll('__APP_BUILD_TIMESTAMP__','privacy-test-build');

function load({hostname='throughthewall.ca',optedOut=false}={}){
  const storage=new Map(optedOut?[['through-the-wall-analytics-opt-out','1']]:[]),listeners=new Map();
  class CustomEvent{constructor(type,options={}){this.type=type;this.detail=options.detail;}}
  const window={
    location:{hostname,origin:`https://${hostname}`,pathname:'/',search:''},
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
production.window.ttwAnalytics.optOut();
assert.equal(production.storage.get('through-the-wall-analytics-opt-out'),'1');
production.window.ttwAnalytics.optIn();
assert.equal(production.storage.has('through-the-wall-analytics-opt-out'),false);
console.log('Analytics production-host and opt-out assertions passed.');
