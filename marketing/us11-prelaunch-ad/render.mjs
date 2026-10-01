import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { canvasFrame } from './canvas-frame.mjs';

const require=createRequire(import.meta.url);
const ffmpeg=require('ffmpeg-static');
const ffprobe=require('ffprobe-static').path;
const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(here,'out');
const timeline=JSON.parse(fs.readFileSync(path.join(here,'timeline.json'),'utf8'));
fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const filename=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'');
  if(!['ad.html','timeline.json','icon.svg'].includes(filename)){res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':mime[path.extname(filename)]});fs.createReadStream(path.join(here,filename)).pipe(res);
});
let port;
function run(cmd,args){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);p.on('error',reject);p.on('close',code=>code===0?resolve(stdout):reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-3000)}`)))});}
function srtTime(seconds){const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`}
function writeSrt(cut){const cues=timeline.cuts[cut].captions.map((c,i)=>`${i+1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');fs.writeFileSync(path.join(out,`captions-${cut}s.srt`),cues)}
async function contactSheet(frames){const tileW=270,tileH=480,cols=6,rows=5;const composites=await Promise.all(frames.map(async({buffer,t},i)=>({input:await sharp(buffer).resize(tileW,tileH).png().toBuffer(),left:(i%cols)*tileW,top:Math.floor(i/cols)*tileH})));await sharp({create:{width:cols*tileW,height:rows*tileH,channels:3,background:'#2a0f3d'}}).composite(composites).png().toFile(path.join(out,'contact-sheet-15s.png'))}
async function renderCut(browser,cut){const cfg=timeline.cuts[cut],frameCount=cfg.duration*timeline.fps;const file=path.join(out,`ttw-us11-${cut}s.mp4`);const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});await page.goto(`http://127.0.0.1:${port}/ad.html?cut=${cut}`,{waitUntil:'load'});await page.evaluate(()=>window.adReady);const fonts=await page.evaluate(()=>({playfair:document.fonts.check('700 88px "Playfair Display"'),inter:document.fonts.check('700 60px Inter')}));if(!fonts.playfair||!fonts.inter)throw new Error(`Google Fonts did not load: ${JSON.stringify(fonts)}`);
  const p=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','30','-vcodec','png','-i','pipe:0','-frames:v',String(frameCount),'-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-preset','slow','-movflags','+faststart',file],{stdio:['pipe','ignore','pipe']});let err='';p.stderr.on('data',d=>err+=d);const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error(`ffmpeg exited ${code}: ${err.slice(-3000)}`)))});const sheet=[];
  for(let frame=0;frame<frameCount;frame++){const t=frame/timeline.fps;await page.evaluate(([seconds,c])=>window.renderAt(seconds,c),[t,cut]);const png=await page.screenshot({type:'png',animations:'disabled'});if(cut==='15'&&frame%15===0)sheet.push({buffer:png,t});if(!p.stdin.write(png))await new Promise(r=>p.stdin.once('drain',r));if(frame%90===0)process.stdout.write(`${cut}s: ${frame}/${frameCount}\n`)}p.stdin.end();await done;await page.close();if(cut==='15'){await contactSheet(sheet);await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',file,'-frames:v','1',path.join(out,'ttw-us11-15s-thumb.png')])}writeSrt(cut);return file}
async function renderCanvasCut(cut){
 const cfg=timeline.cuts[cut],frameCount=cfg.duration*timeline.fps,file=path.join(out,`ttw-us11-${cut}s.mp4`);
 const p=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','30','-vcodec','png','-i','pipe:0','-frames:v',String(frameCount),'-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-preset','slow','-movflags','+faststart',file],{stdio:['pipe','ignore','pipe']});let err='';p.stderr.on('data',d=>err+=d);const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error(`ffmpeg exited ${code}: ${err.slice(-3000)}`)))});const sheet=[];
 for(let frame=0;frame<frameCount;frame++){const t=frame/timeline.fps,png=canvasFrame(t,cut,timeline);if(cut==='15'&&frame%15===0)sheet.push({buffer:png,t});if(!p.stdin.write(png))await new Promise(r=>p.stdin.once('drain',r));if(frame%90===0)process.stdout.write(`${cut}s: ${frame}/${frameCount} (graphics renderer)\n`)}p.stdin.end();await done;if(cut==='15'){await contactSheet(sheet);await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',file,'-frames:v','1',path.join(out,'ttw-us11-15s-thumb.png')])}writeSrt(cut);return file
}
async function muxVoiceover(video,cut){const audio=path.join(here,`vo-${cut}s.m4a`);if(!fs.existsSync(audio))return;const dest=path.join(out,`ttw-us11-${cut}s-vo.mp4`);await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',video,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-af','apad','-t',String(timeline.cuts[cut].duration),'-movflags','+faststart',dest]);}
async function probe(file){return JSON.parse(await run(ffprobe,['-v','error','-count_frames','-show_entries','format=duration:stream=codec_type,codec_name,pix_fmt,width,height,nb_read_frames','-of','json',file]))}
let browser;
try{
 const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
 if(process.env.TTW_RENDERER!=='canvas')try{browser=await chromium.launch({headless:true,executablePath:executable||undefined,args:['--no-sandbox']})}
 catch(error){console.warn('Chromium unavailable here; using deterministic graphics renderer.');}
 if(browser)try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});port=server.address().port}
 catch(error){console.warn('Preview server unavailable here; using deterministic graphics renderer.');await browser.close();browser=null}
 for(const cut of ['15','6']){let file;if(browser){try{file=await renderCut(browser,cut)}catch(error){console.warn(`Browser render failed for ${cut}s; using deterministic graphics renderer: ${error.message}`);await browser.close();browser=null;file=await renderCanvasCut(cut)}}else file=await renderCanvasCut(cut);await muxVoiceover(file,cut);const data=await probe(file);const video=data.streams.find(s=>s.codec_type==='video');if(video.width!==1080||video.height!==1920||video.pix_fmt!=='yuv420p'||Number(video.nb_read_frames)!==timeline.cuts[cut].duration*30||Math.abs(Number(data.format.duration)-timeline.cuts[cut].duration)>.002)throw new Error(`Probe failed for ${cut}s: ${JSON.stringify(data)}`);console.log(`${path.basename(file)}: ${data.format.duration}s, ${video.nb_read_frames} frames, ${video.width}x${video.height}, ${video.pix_fmt}`)}
}finally{await browser?.close();if(server.listening)server.close()}
