#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const readConfig=(key)=>{
  const match=html.match(new RegExp(`${key}:\\s*["']([^"']+)["']`));
  if(!match)throw new Error(`Firebase ${key} is missing from index.html.`);
  return match[1];
};

const apiKey=readConfig('apiKey');
const projectId=readConfig('projectId');
const appId=readConfig('appId');
const debugToken=String(process.env.APP_CHECK_DEBUG_TOKEN||'').trim();
if(!debugToken)throw new Error('APP_CHECK_DEBUG_TOKEN is required.');

async function postJson(url,body,headers={}){
  const response=await fetch(url,{
    method:'POST',
    headers:{'content-type':'application/json',...headers},
    body:JSON.stringify(body),
  });
  const text=await response.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch(error){data={raw:text};}
  return {response,data};
}

async function main(){
  const suffix=`${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  const email=`ttw-app-check-${suffix}@example.com`;
  const password=`Ttw-${suffix}-verify!`;
  let idToken='';
  try{
    const signup=await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,{
      email,password,returnSecureToken:true,
    });
    if(!signup.response.ok||!signup.data.idToken)throw new Error(`Temporary Firebase Auth signup failed (${signup.response.status}).`);
    idToken=signup.data.idToken;

    const exchange=await postJson(
      `https://firebaseappcheck.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(appId)}:exchangeDebugToken?key=${encodeURIComponent(apiKey)}`,
      {debugToken},
    );
    if(!exchange.response.ok||!exchange.data.token)throw new Error(`App Check debug-token exchange failed (${exchange.response.status}).`);

    const headers={authorization:`Bearer ${idToken}`,'x-firebase-appcheck':exchange.data.token};
    const assertDomainError=async (name,data)=>{
      const callable=await postJson(`https://us-central1-${projectId}.cloudfunctions.net/${name}`,{data},headers);
      const status=String(callable.data?.error?.status||'');
      const message=String(callable.data?.error?.message||'');
      if(callable.response.status!==400||status!=='INVALID_ARGUMENT'){
        throw new Error(`Expected ${name} INVALID_ARGUMENT, received HTTP ${callable.response.status} ${status||'without a callable status'}.`);
      }
      console.log(`${name} reached application logic: HTTP 400 ${status} — ${message}`);
    };
    await assertDomainError('reopenPhase',{});
    await assertDomainError('openGlobalPool',{action:'not-a-real-action'});
  }finally{
    if(idToken){
      const cleanup=await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`,{idToken});
      if(!cleanup.response.ok)throw new Error(`Temporary Firebase Auth cleanup failed (${cleanup.response.status}).`);
    }
  }
}

main().catch(error=>{console.error(error.message);process.exitCode=1;});
