#!/usr/bin/env node
// Narrow profile for kit/production-templates only. The original blog release
// scanner and its template-tail checks remain unchanged.
import {createHash} from 'node:crypto';
import {lstat,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const hash=data=>createHash('sha256').update(data).digest('hex');
const safe=name=>typeof name==='string'&&name&&!path.posix.isAbsolute(name)&&!name.includes('\\')&&!name.split('/').some(x=>!x||x==='.'||x==='..'||x==='.git');
const allowed=name=>['README.md','template-provenance.json'].includes(name)||/^scripts\/(premium_article|create_video_page)\.py$/.test(name)||/^templates\/(trainup-premium-article-v1\.0\.2|trainup-video-single|ai-director-latest-20261026)\//.test(name);
export async function scanProductionTemplates(input){
 const root=path.resolve(input),findings=[],found=new Map();
 const add=(type,name,message)=>findings.push({type,path:name,message});
 const rootInfo=await lstat(root);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw Error('Profile root must be a real directory');
 const manifestPath=path.join(root,'public-manifest.json');
 if((await lstat(manifestPath)).isSymbolicLink())throw Error('Manifest cannot be a symlink');
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 if(manifest.schema!==1||!manifest.files||Array.isArray(manifest.files))throw Error('Invalid production profile manifest');
 const folded=new Set();
 for(const [name,digest]of Object.entries(manifest.files)){
  if(!safe(name)||!allowed(name)||!/^[a-f0-9]{64}$/.test(digest))throw Error('Unsafe profile allowlist entry');
  const lower=name.toLowerCase();if(folded.has(lower))throw Error('Case-colliding profile paths');folded.add(lower);
 }
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name),name=path.relative(root,full).split(path.sep).join('/'),info=await lstat(full);
  if(info.isSymbolicLink()){add('symlink',name,'Symlink forbidden');continue;}
  if(info.isDirectory()){await walk(full);continue;}
  if(!info.isFile()){add('special-file',name,'Regular files only');continue;}
  if(name==='public-manifest.json')continue;
  const bytes=await readFile(full);found.set(name,hash(bytes));
  if(name.includes('/assets/gallery/')&&!/\/example-review-\d{2}\.svg$/.test(name))add('personal-asset-name',name,'Review slots use neutral numbered paths');
  if(!allowed(name)||!(name in manifest.files))add('unlisted-file',name,'Not in this narrow profile');
  if(manifest.files[name]!==hash(bytes))add('checksum',name,'SHA256 mismatch');
  if(/\.(?:webp|png|jpe?g)$/i.test(name)){
   if(!['templates/trainup-premium-article-v1.0.2/assets/diagram/turbo-packaging-event-v3-c03f356d00b3.webp','templates/ai-director-latest-20261026/assets/diagram/turbo-packaging-event-v3-c03f356d00b3.webp'].includes(name)||hash(bytes)!=='c03f356d00b3e5fc23796a110d5bc3ffe35a6636506dc5e67b9cb6f3f16a0cd3')add('unverified-media',name,'Only the accepted generated diagram is allowed; no photos/screenshots');
   continue;
  }
  if(!/\.(?:md|py|json|css|js|html|svg)$/.test(name)){add('file-type',name,'Unexpected payload type');continue;}
  const text=bytes.toString('utf8');
  if(name.endsWith('.html')&&/data-case-id="(?!example-case-\d{2}")[^"]+"/.test(text))add('personal-case-id',name,'Case slots use neutral numbered identifiers');
  if(/\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\|file:\/\//.test(text))add('personal-path',name,'Workstation path');
  if(/ИНН\s*\d{10,12}|ОГРН\s*\d{13,15}|t\.me\/egor_b|info@trainup\.ru|74957443791/.test(text))add('private-identity',name,'Private contact/legal identity');
  if(/(?:ghp_|github_pat_|sk-proj-|AKIA[A-Z0-9]{16}|-----BEGIN .*PRIVATE KEY)|["'](?:access_token|refresh_token|private_key|password)["']\s*:\s*["'][^"']{8}/.test(text))add('secret',name,'Credential-shaped value');
  if(/data-oto|starterKey|ltBlock\d+|225654870\d|4777892|k1HGHK6JK1GeTD1ekFY4je/.test(text))add('account-binding',name,'Cabinet/OTO/video binding');
  if(name.endsWith('.html')&&/<iframe\b|<video\b|https?:\/\/(?:kinescope\.io|fs\.getcourse\.ru)\//i.test(text))add('active-media',name,'HTML must remain an unbound preview');
  if(name.endsWith('.css')&&/@font-face|@import/.test(text))add('external-font',name,'No unverified font distribution');
  for(const match of text.matchAll(/(?:src|href)="([^"#][^"]*)"/g)){
   const value=match[1];if(/^(?:https?:|data:|mailto:|tel:|\/\/)/i.test(value)||value.startsWith('/'))continue;
   const clean=value.split(/[?#]/)[0];if(!clean)continue;
   const refBase=/^templates\/[^/]+\/components\//.test(name)?path.dirname(path.dirname(full)):path.dirname(full);
   const target=path.resolve(refBase,clean),relative=path.relative(root,target).split(path.sep).join('/');
   // Python source contains configurable HTML strings. Actual generated HTML
   // references are verified for template .html/.css/.svg files only.
   if(!/\.(?:html|svg)$/.test(name))continue;
   if(relative.startsWith('../')){add('reference-escape',name,value);continue;}
   const exists=await lstat(target).catch(()=>null);if(!exists?.isFile()||exists.isSymbolicLink())add('broken-reference',name,value);
  }
 }}
 await walk(root);
 for(const name of Object.keys(manifest.files))if(!found.has(name))add('missing-file',name,'Allowlisted file missing');
 return {ok:findings.length===0,profile:'production-templates-v1',fileCount:found.size,findings};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await scanProductionTemplates(process.argv[2]||new URL('../kit/production-templates/',import.meta.url).pathname);
 console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
