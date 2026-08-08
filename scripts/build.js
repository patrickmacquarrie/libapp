const fs=require('fs');
const path=require('path');
const vm=require('vm');
const Babel=require('@babel/standalone');
const sharp=require('sharp');

const root=path.resolve(__dirname,'..');
const dist=path.join(root,'dist');
const sourcePath=path.join(root,'index.html');
const cachePath=path.join(__dirname,'season-pages-cache.json');
const CAST_LIMIT=100*1024;
const SOCIAL_LIMIT=200*1024;

const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[ch]));
const slugFile=value=>String(value||'').split('/').pop().split('?')[0]
  .replace(/\.(png|jpe?g|webp)$/i,'').replace(/[^a-z0-9 _.-]/gi,'').trim();
const titleCase=value=>String(value||'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase());

function readBalancedArray(source,marker) {
  const markerAt=source.indexOf(marker);
  if(markerAt<0) throw new Error(`Could not find ${marker}.`);
  const start=source.indexOf('[',markerAt);
  let depth=0, quote='', escaped=false;
  for(let index=start;index<source.length;index++) {
    const ch=source[index];
    if(quote) {
      if(escaped) escaped=false;
      else if(ch==='\\') escaped=true;
      else if(ch===quote) quote='';
      continue;
    }
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='[') depth++;
    if(ch===']'&&--depth===0) return source.slice(start,index+1);
  }
  throw new Error(`Could not parse ${marker}.`);
}

function seasonBankFrom(source) {
  const literal=readBalancedArray(source,'const SEASON_BANK');
  const bank=vm.runInNewContext(`(${literal})`,{DEFAULT_SEASON_ID:'love-is-blind-uk-3'},{timeout:1000});
  if(!Array.isArray(bank)||!bank.length) throw new Error('SEASON_BANK is empty.');
  return bank;
}

function parseCsv(text) {
  const rows=[]; let row=[],field='',quoted=false,wasQuoted=false;
  const pushField=()=>{row.push(wasQuoted?field:field.trim());field='';wasQuoted=false;};
  const pushRow=()=>{pushField();if(row.some(cell=>cell!==''))rows.push(row);row=[];};
  for(let index=0;index<text.length;index++) {
    const ch=text[index];
    if(ch==='"') {
      if(quoted&&text[index+1]==='"'){field+='"';index++;}
      else {quoted=!quoted;wasQuoted=true;}
    } else if(ch===','&&!quoted) pushField();
    else if((ch==='\r'||ch==='\n')&&!quoted) {
      if(ch==='\r'&&text[index+1]==='\n') index++;
      pushRow();
    } else field+=ch;
  }
  if(quoted) throw new Error('Unterminated CSV field.');
  if(field||row.length) pushRow();
  return rows;
}

function rowsToObjects(rows) {
  if(rows.length<2) return [];
  const counts={};
  const headers=rows[0].map(value=>{
    const base=String(value).toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
    counts[base]=(counts[base]||0)+1;
    return counts[base]===1?base:`${base}_${counts[base]}`;
  });
  return rows.slice(1).filter(row=>row.some(Boolean)).map(row=>Object.fromEntries(headers.map((header,index)=>[header,row[index]||''])));
}

async function fetchSheetTab(sheetId,tab) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  const url=`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  try {
    const response=await fetch(url,{signal:controller.signal});
    if(!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text=await response.text();
    if(text.trimStart().startsWith('<')) throw new Error('sheet is not public');
    return rowsToObjects(parseCsv(text));
  } finally { clearTimeout(timeout); }
}

function readCache() {
  try{return JSON.parse(fs.readFileSync(cachePath,'utf8'));}
  catch{return {};}
}

async function loadSeasonData(season,cache) {
  if(!season.sheetId) return cache[season.id]||{cast:[],couples:[],settings:[]};
  try {
    const [cast,couples,settings]=await Promise.all([
      fetchSheetTab(season.sheetId,'Cast'),
      fetchSheetTab(season.sheetId,'Couples'),
      fetchSheetTab(season.sheetId,'Settings'),
    ]);
    cache[season.id]={cast,couples,settings};
    return cache[season.id];
  } catch(error) {
    if(cache[season.id]) {
      console.warn(`Using cached page data for ${season.id}: ${error.message}`);
      return cache[season.id];
    }
    console.warn(`No sheet data for ${season.id}: ${error.message}`);
    return {cast:[],couples:[],settings:[]};
  }
}

function copyTreeExcept(source,target,exclude=()=>false) {
  if(!fs.existsSync(source)) return;
  for(const entry of fs.readdirSync(source,{withFileTypes:true})) {
    const input=path.join(source,entry.name);
    if(exclude(input,entry)) continue;
    const output=path.join(target,entry.name);
    if(entry.isDirectory()) {
      fs.mkdirSync(output,{recursive:true});
      copyTreeExcept(input,output,exclude);
    } else {
      fs.mkdirSync(path.dirname(output),{recursive:true});
      fs.copyFileSync(input,output);
    }
  }
}

async function optimizeImages() {
  const sourceImages=path.join(root,'images');
  const outputImages=path.join(dist,'images');
  fs.rmSync(outputImages,{recursive:true,force:true});
  fs.mkdirSync(outputImages,{recursive:true});
  copyTreeExcept(sourceImages,outputImages,(input,entry)=>{
    const relative=path.relative(sourceImages,input);
    return relative==='cast'||relative.startsWith(`cast${path.sep}`)||relative==='through-the-wall-social-card.png';
  });

  const sourceCast=path.join(sourceImages,'cast');
  const outputCast=path.join(outputImages,'cast');
  const jobs=[];
  function visit(directory) {
    if(!fs.existsSync(directory)) return;
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const input=path.join(directory,entry.name);
      if(entry.isDirectory()) visit(input);
      else if(/\.(png|jpe?g|webp)$/i.test(entry.name)) {
        const relative=path.relative(sourceCast,input).replace(/\.(png|jpe?g|webp)$/i,'.webp');
        const output=path.join(outputCast,relative);
        jobs.push((async()=>{
          fs.mkdirSync(path.dirname(output),{recursive:true});
          await sharp(input).rotate().resize(256,256,{fit:'cover',withoutEnlargement:true}).webp({quality:78,effort:5}).toFile(output);
          const size=fs.statSync(output).size;
          if(size>CAST_LIMIT) throw new Error(`${path.relative(dist,output)} is ${(size/1024).toFixed(1)}KB; limit is 100KB.`);
        })());
      }
    }
  }
  visit(sourceCast);
  await Promise.all(jobs);

  const socialSource=path.join(sourceImages,'through-the-wall-social-card.png');
  if(fs.existsSync(socialSource)) {
    const socialOutput=path.join(outputImages,'through-the-wall-social-card.png');
    await sharp(socialSource).png({palette:true,colours:128,dither:.6,compressionLevel:9,effort:10}).toFile(socialOutput);
    const size=fs.statSync(socialOutput).size;
    if(size>SOCIAL_LIMIT) throw new Error(`Social card is ${(size/1024).toFixed(1)}KB; limit is 200KB.`);
  }
  return jobs.length;
}

const seasonIntro={
  'love-is-blind-us-1':'The Atlanta experiment that introduced the pods, the proposals, and the question at the centre of it all.',
  'love-is-blind-us-2':'Chicago singles stepped into the pods with bold connections and an especially unpredictable road to the altar.',
  'love-is-blind-us-3':'Dallas delivered complicated triangles, emotional vows, and choices that kept every prediction alive.',
  'love-is-blind-us-4':'Seattle brought instant fan favourites, second chances, and one of the franchise’s most memorable ensembles.',
  'love-is-blind-us-5':'Houston’s season tested pod connections against messy histories and difficult real-world reckonings.',
  'love-is-blind-us-6':'Charlotte mixed magnetic pod chemistry with sharp turns once the couples left the experiment.',
  'love-is-blind-us-7':'Washington, D.C. put ambitious singles and high-stakes commitments through the full experiment.',
  'love-is-blind-us-8':'Minneapolis brought Midwest singles into a season built around compatibility, community, and commitment.',
  'love-is-blind-us-9':'Denver’s cast takes the experiment into the Rockies, where every connection becomes a prediction opportunity.',
  'love-is-blind-us-10':'The tenth U.S. experiment gives fantasy players a milestone season to call before the reveals land.',
  'love-is-blind-uk-1':'The first UK experiment crossed the pods with British dating culture and a brand-new field of predictions.',
  'love-is-blind-uk-3':'A new UK cast enters the pods, giving friends another season of engagements, breakups, and altar calls to forecast.',
};

function settingMap(data) {return Object.fromEntries((data.settings||[]).map(row=>[row.key,row.value]));}

function seasonPage(season,data) {
  const settings=settingMap(data);
  const cast=(data.cast||[]).filter(row=>row.name);
  const couples=(data.couples||[]).filter(row=>row.person_a||row.person_b||row.him||row.her||row.couple||row.id);
  const place=season.locationLabel||season.country;
  const intro=seasonIntro[season.id]||`${season.label} brings a fresh group of singles into the pods in ${place}.`;
  const castNames=cast.map(row=>row.name);
  const castList=cast.length?cast.map(person=>{
    const file=slugFile(person.photo_url||person.image_url||person.photo||person.name);
    const image=file&&fs.existsSync(path.join(dist,'images','cast',season.id,`${file}.webp`))
      ? `/images/cast/${encodeURIComponent(season.id)}/${encodeURIComponent(file)}.webp`
      : '';
    return `<li>${image?`<img loading="lazy" width="72" height="72" src="${image}" alt="${esc(person.name)}">`:''}<span>${esc(person.name)}</span></li>`;
  }).join(''):'<li><span>Cast details are being prepared.</span></li>';
  const coupleList=couples.length?couples.slice(0,12).map(row=>{
    const names=row.couple||[row.person_a||row.him,row.person_b||row.her].filter(Boolean).join(' + ')||titleCase(row.id);
    const outcome=row.outcome||row.result||row.status||row.wedding||(row.breakup_ep?'Broke up':'');
    return `<li><strong>${esc(names)}</strong>${outcome?`<span>${esc(titleCase(outcome))}</span>`:''}</li>`;
  }).join(''):'<li><strong>Predictions open in the app</strong><span>Call the connections before outcomes are revealed.</span></li>';
  const castSentence=castNames.length
    ? `This season page follows ${castNames.slice(0,4).map(esc).join(', ')}${castNames.length>4?`, and ${castNames.length-4} more singles`:''}.`
    : `Cast information for ${esc(season.label)} will appear as the season data is published.`;
  const featuredCouples=couples.slice(0,3).map(row=>row.couple||[row.person_a||row.him,row.person_b||row.her].filter(Boolean).join(' and ')||titleCase(row.id)).filter(Boolean);
  const outcomeSentence=featuredCouples.length
    ? `${esc(season.label)} tracks connections including ${featuredCouples.map(esc).join(', ')} as they move from the pods toward their final decisions.`
    : `${esc(season.label)} outcomes will be organized here as engagements and real-world relationship decisions become available.`;
  const release=settings.RELEASE_LABEL||season.releaseLabel||'Available now';
  const canonical=`https://throughthewall.ca/seasons/${season.id}/`;
  const schema={
    '@context':'https://schema.org','@type':'TVSeason',name:season.label,
    seasonNumber:season.seasonNumber,url:canonical,
    partOfSeries:{'@type':'TVSeries',name:'Love Is Blind'},
    countryOfOrigin:{'@type':'Country',name:season.country},
    description:`Fantasy predictions and cast guide for ${season.label}.`,
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(season.label)} fantasy predictions | Through the Wall</title>
<meta name="description" content="Explore the ${esc(season.label)} cast and outcomes, then create a free fantasy prediction pool with friends.">
<link rel="canonical" href="${canonical}"><meta property="og:title" content="${esc(season.label)} fantasy predictions">
<meta property="og:description" content="Make your Love Is Blind calls, compare picks, and climb the standings with friends.">
<meta property="og:image" content="https://throughthewall.ca/images/through-the-wall-social-card.png">
<meta property="og:url" content="${canonical}"><meta property="og:type" content="website">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>
<script defer data-domain="throughthewall.ca" src="https://plausible.io/js/script.js"></script>
<style>:root{color-scheme:light;--wine:#4c1930;--pink:#ff8db7;--cream:#fff8f2;--ink:#24141c}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:var(--cream);line-height:1.55}header,main,footer{max-width:1040px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center}.brand{font-weight:900;color:var(--wine);text-decoration:none}.hero{padding:72px 24px 44px}.eyebrow{color:#9b3f67;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.hero h1{font-size:clamp(2.5rem,8vw,5rem);line-height:.95;max-width:850px;margin:.2em 0}.hero p{max-width:680px;font-size:1.15rem}.cta{display:inline-block;margin-top:18px;background:var(--wine);color:white;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:850}.grid{display:grid;grid-template-columns:1.1fr .9fr;gap:28px}.card{background:white;border:1px solid #ead9df;border-radius:22px;padding:26px;box-shadow:0 14px 40px #4c19300c}.cast{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));list-style:none;padding:0;gap:12px}.cast li{display:flex;align-items:center;gap:10px;font-weight:750}.cast img{border-radius:50%;object-fit:cover;background:#f0e2e7}.couples{list-style:none;padding:0}.couples li{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #eee;padding:12px 0}.couples span{color:#735864;text-align:right}footer{color:#735864}footer a{color:inherit}@media(max-width:720px){.grid{grid-template-columns:1fr}.hero{padding-top:48px}}</style></head>
<body><header><a class="brand" href="/">Through the Wall</a><a href="/welcome/">How it works</a></header>
<main><section class="hero"><div class="eyebrow">${esc(place)} · Season ${esc(season.seasonNumber)} · ${esc(release)}</div><h1>${esc(season.label)}</h1><p>${esc(intro)}</p><a class="cta" data-placement="season_hero" href="/?start=create&amp;season=${encodeURIComponent(season.id)}">Create a free pool</a></section>
<section class="grid"><article class="card"><h2>Meet the cast</h2><p>${castSentence}</p><ul class="cast">${castList}</ul></article><article class="card"><h2>Couples and outcomes</h2><p>${outcomeSentence}</p><ul class="couples">${coupleList}</ul></article></section>
<section class="hero"><h2>Turn every episode into a friendly competition</h2><p>Through the Wall scores picks across the pods, retreats, weddings, and reunion. Invite friends, lock each phase, and watch the standings move as outcomes land.</p><a class="cta" data-placement="season_footer" href="/?start=create&amp;season=${encodeURIComponent(season.id)}">Start ${esc(season.label)}</a></section></main>
<footer><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></footer>
<script>document.querySelectorAll('[data-placement]').forEach(link=>link.addEventListener('click',()=>window.plausible&&window.plausible('create_pool_click',{props:{placement:link.dataset.placement,season:'${esc(season.id)}'}})));</script></body></html>`;
}

async function build() {
  const source=fs.readFileSync(sourcePath,'utf8');
  const seasons=seasonBankFrom(source);
  const available=seasons.filter(season=>season.available);
  const babelScript=/<script\s+type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
  const match=source.match(babelScript);
  if(!match) throw new Error('Could not find the editable text/babel script in index.html.');
  const babelCdn=/\s*<script[^>]+babel-standalone[^>]*><\/script>/;
  if(!babelCdn.test(source)) throw new Error('Could not find the browser-only Babel CDN script.');

  fs.mkdirSync(dist,{recursive:true});
  const compiled=Babel.transform(match[1],{presets:['react']}).code;
  const app=source.replace(babelCdn,'').replace(babelScript,`<script>\n${compiled}\n</script>`)
    .replaceAll('__APP_BUILD_TIMESTAMP__',new Date().toISOString());
  fs.writeFileSync(path.join(dist,'index.html'),app);

  const optimizedCount=await optimizeImages();
  for(const directory of ['welcome']) {
    const input=path.join(root,directory);
    const output=path.join(dist,directory);
    fs.rmSync(output,{recursive:true,force:true});
    if(fs.existsSync(input)) fs.cpSync(input,output,{recursive:true});
  }
  for(const file of ['manifest.webmanifest','privacy.html','terms.html']) {
    const input=path.join(root,file);
    if(fs.existsSync(input)) fs.copyFileSync(input,path.join(dist,file));
  }

  const cache=readCache();
  const seasonData=await Promise.all(available.map(async season=>[season,await loadSeasonData(season,cache)]));
  fs.writeFileSync(cachePath,`${JSON.stringify(cache,null,2)}\n`);
  const seasonRoot=path.join(dist,'seasons');
  fs.rmSync(seasonRoot,{recursive:true,force:true});
  for(const [season,data] of seasonData) {
    const directory=path.join(seasonRoot,season.id);
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'index.html'),seasonPage(season,data));
  }

  const urls=['https://throughthewall.ca/','https://throughthewall.ca/welcome/','https://throughthewall.ca/privacy.html','https://throughthewall.ca/terms.html',
    ...available.map(season=>`https://throughthewall.ca/seasons/${season.id}/`)];
  fs.writeFileSync(path.join(dist,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url=>`  <url><loc>${url}</loc></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(dist,'robots.txt'),'User-agent: *\nAllow: /\nSitemap: https://throughthewall.ca/sitemap.xml\n');

  const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
  const client=fs.readFileSync(path.join(root,'index.html'),'utf8');
  if(!/snapshot\.version\s*>=\s*3\s*&&\s*snapshot\.version\s*<=\s*4/.test(rules)) throw new Error('Firestore rules do not accept snapshots 3–4.');
  const snapshotFactory=client.slice(client.indexOf('const rulesSnapshotFrom'),client.indexOf('const configForPool'));
  if(!/version\s*:\s*4/.test(snapshotFactory)) throw new Error('Client rules snapshot version is not 4.');

  console.log(`Built app, ${available.length} static season pages, and ${optimizedCount} optimized cast images.`);
}

build().catch(error=>{console.error(error);process.exitCode=1;});
