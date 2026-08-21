const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright-chromium');

const root=path.resolve(__dirname,'..');
const dist=path.resolve(process.env.SMOKE_DIST_DIR||path.join(root,'dist'));
const mimeTypes={
  '.css':'text/css; charset=utf-8',
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png',
  '.svg':'image/svg+xml',
  '.webmanifest':'application/manifest+json; charset=utf-8',
  '.webp':'image/webp',
  '.xml':'application/xml; charset=utf-8',
};

function resolveRequestFile(requestUrl) {
  const pathname=decodeURIComponent(new URL(requestUrl,'http://localhost').pathname);
  const relative=pathname.replace(/^\/+/, '');
  const candidate=path.resolve(dist,relative||'index.html');
  if(candidate!==dist&&!candidate.startsWith(`${dist}${path.sep}`))return null;
  try{
    return fs.statSync(candidate).isDirectory()?path.join(candidate,'index.html'):candidate;
  }catch(error){
    return pathname.endsWith('/')?path.join(candidate,'index.html'):candidate;
  }
}

function startServer() {
  const server=http.createServer((request,response)=>{
    const file=resolveRequestFile(request.url||'/');
    if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){
      response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});
      response.end('Not found');
      return;
    }
    response.writeHead(200,{
      'Cache-Control':'no-store',
      'Content-Type':mimeTypes[path.extname(file).toLowerCase()]||'application/octet-stream',
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>resolve(server));
  });
}

function generatedSeasonPath() {
  const seasonsDirectory=path.join(dist,'seasons');
  const season=fs.readdirSync(seasonsDirectory,{withFileTypes:true})
    .find(entry=>entry.isDirectory()&&fs.existsSync(path.join(seasonsDirectory,entry.name,'index.html')));
  assert(season,'The build did not generate a season page under dist/seasons/.');
  return `/seasons/${encodeURIComponent(season.name)}/`;
}

async function inspectPage(browser,baseUrl,test) {
  const context=await browser.newContext();
  await context.addInitScript(()=>{
    window.__ttwSmokeUnhandledRejections=[];
    window.addEventListener('unhandledrejection',event=>{
      const reason=event.reason;
      window.__ttwSmokeUnhandledRejections.push(reason?.stack||reason?.message||String(reason));
    });
  });
  const page=await context.newPage();
  const failures=[];
  page.on('console',message=>{
    if(message.type()==='error')failures.push(`console error: ${message.text()}`);
  });
  page.on('pageerror',error=>failures.push(`uncaught page error: ${error.stack||error.message}`));
  try{
    const response=await page.goto(`${baseUrl}${test.pathname}`,{waitUntil:'domcontentloaded',timeout:15000});
    assert(response&&response.ok(),`${test.pathname} returned HTTP ${response?.status()||'no response'}.`);
    assert.equal(await page.locator('#root').count(),test.react?1:0,`${test.pathname} has an unexpected root element count.`);
    if(test.react){
      await page.waitForFunction(acceptedTexts=>{
        const root=document.getElementById('root');
        if(!root)return true;
        return Boolean(root.querySelector('.fatal-app')||root.querySelector('.root-boot[role="alert"]'))||
          acceptedTexts.some(text=>root.querySelector('.app')?.textContent?.includes(text));
      },test.texts,{timeout:15000});
      assert.equal(await page.locator('#root .fatal-app').count(),0,`${test.pathname} rendered the AppErrorBoundary fallback.`);
      assert.equal(await page.locator('#root .root-boot[role="alert"]').count(),0,`${test.pathname} rendered the pre-mount boot-failure fallback.`);
      const renderedState=await page.locator('#root .app').innerText();
      assert(test.texts.some(text=>renderedState.includes(text)),`${test.pathname} did not render a recognised checking or signed-out state.`);
    }else{
      await page.getByText(test.text,{exact:false}).first().waitFor({state:'visible',timeout:15000});
    }
    await page.waitForTimeout(100);
    const rejections=await page.evaluate(()=>window.__ttwSmokeUnhandledRejections||[]);
    rejections.forEach(reason=>failures.push(`unhandled promise rejection: ${reason}`));
    assert.deepEqual(failures,[],`${test.pathname} emitted browser errors:\n${failures.join('\n')}`);
  }finally{
    await context.close();
  }
}

async function main() {
  assert(fs.existsSync(path.join(dist,'index.html')),`Built app not found at ${path.join(dist,'index.html')}. Run npm run build first.`);
  const server=await startServer();
  const address=server.address();
  const baseUrl=`http://127.0.0.1:${address.port}`;
  let browser;
  try{
    browser=await chromium.launch({headless:true});
    const tests=[
      {pathname:'/',react:true,texts:['Getting the pods ready…','Save your picks and play with friends']},
      {pathname:'/?join=smoke-pool.smoke-code',react:true,texts:['Getting the pods ready…','Your pool invitation is ready']},
      {pathname:generatedSeasonPath(),react:false,text:'Create a free pool'},
      {pathname:'/welcome/',react:false,text:'Love Is Blind is better when everyone brings'},
    ];
    for(const test of tests)await inspectPage(browser,baseUrl,test);
    console.log(`Built-app smoke test passed for ${tests.map(test=>test.pathname).join(', ')}.`);
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
