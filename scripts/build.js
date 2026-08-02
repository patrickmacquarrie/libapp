const fs=require('fs');
const path=require('path');
const Babel=require('@babel/standalone');

const root=path.resolve(__dirname,'..');
const sourcePath=path.join(root,'index.html');
const outputPath=path.join(root,'dist','index.html');
const source=fs.readFileSync(sourcePath,'utf8');
const babelScript=/<script\s+type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
const match=source.match(babelScript);

if(!match) throw new Error('Could not find the editable text/babel script in index.html.');

const compiled=Babel.transform(match[1],{presets:['react']}).code;
const babelCdn=/\s*<script[^>]+babel-standalone[^>]*><\/script>/;
if(!babelCdn.test(source))throw new Error('Could not find the browser-only Babel CDN script in index.html. Refusing to ship a duplicate compiler.');
const withoutBabelCdn=source.replace(babelCdn,'');
const buildTimestamp=new Date().toISOString();
const output=withoutBabelCdn
  .replace(babelScript,`<script>\n${compiled}\n</script>`)
  .replaceAll('__APP_BUILD_TIMESTAMP__',buildTimestamp);

fs.mkdirSync(path.dirname(outputPath),{recursive:true});
fs.writeFileSync(outputPath,output);
const imagesPath=path.join(root,'images');
if(fs.existsSync(imagesPath)) {
  fs.cpSync(imagesPath,path.join(root,'dist','images'),{recursive:true});
}
const welcomePath=path.join(root,'welcome');
if(fs.existsSync(welcomePath)) {
  fs.cpSync(welcomePath,path.join(root,'dist','welcome'),{recursive:true});
}
['manifest.webmanifest','privacy.html','terms.html'].forEach(file=>{
  const sourceFile=path.join(root,file);
  if(fs.existsSync(sourceFile))fs.copyFileSync(sourceFile,path.join(root,'dist',file));
});
console.log('Built dist/index.html');
