import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const kit=path.join(root,'kit/production-templates');
test('accepted source provenance and the original simple layout remain distinct',async()=>{
 const provenance=JSON.parse(await readFile(path.join(kit,'template-provenance.json'),'utf8'));
 assert.equal(provenance.templates.premium.upstreamCommit,'3e84b7ffa2a8d83d0ea68cca77c44a2892db462a');
 assert.equal(provenance.templates.single.upstreamCommit,'422d8fb28d1d04a32f0a1335ed4fcc84a931ed03');
 assert.equal(provenance.templates.single.sourceCommit,'ba896b13eb7ab51991a7cab1743874fd7b8f79ba');
});
test('premium constructor verifies and creates an offline preview with no live checkout',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'pro-template '));
 const script=path.join(kit,'scripts/premium_article.py');
 const python=process.env.PYTHON||'python3';
 execFileSync(python,[script,'check-template'],{cwd:dir});
 execFileSync(python,[script,'create','--output',path.join(dir,'page')],{cwd:dir});
 const html=await readFile(path.join(dir,'page/raw-html.html'),'utf8');
 assert.match(html,/ИИ-директор/);assert.match(html,/data-checkout-mode="preview"/);
 assert.doesNotMatch(html,/ИНН\s*\d{10,12}|ltBlock\d+/);
});

test('narrow production scanner rejects account material even with an updated file checksum',async()=>{
 const {scanProductionTemplates}=await import('../scripts/scan-production-templates.mjs');
 const {createHash}=await import('node:crypto');
 const dir=await mkdtemp(path.join(tmpdir(),'pro-scan '));
 const name='templates/trainup-video-single/index.html';
 await mkdir(path.join(dir,path.dirname(name)),{recursive:true});
 const text='<p>ИНН '+ '1'.repeat(12) +'</p>';
 await writeFile(path.join(dir,name),text);
 await writeFile(path.join(dir,'public-manifest.json'),JSON.stringify({schema:1,files:{[name]:createHash('sha256').update(text).digest('hex')}}));
 const result=await scanProductionTemplates(dir);
 assert.equal(result.ok,false);assert(result.findings.some(x=>x.type==='private-identity'));
});
test('the exact derivative profile has all component and page asset references',async()=>{
 const {scanProductionTemplates}=await import('../scripts/scan-production-templates.mjs');
 const result=await scanProductionTemplates(kit);assert.equal(result.ok,true,JSON.stringify(result.findings));
});
test('latest accepted26Oct program is created separately from13Oct and the29Oct drafts',async()=>{
 const provenance=JSON.parse(await readFile(path.join(kit,'template-provenance.json'),'utf8'));
 assert.equal(provenance.templates.latest.sourceCommit,'0f79daf095428fd8f39f21c62607d02df927c9da');
 const dir=await mkdtemp(path.join(tmpdir(),'latest accepted '));
 execFileSync(process.env.PYTHON||'python3',[path.join(kit,'scripts/premium_article.py'),'create','--template','latest','--output',path.join(dir,'page')],{cwd:dir});
 const html=await readFile(path.join(dir,'page/raw-html.html'),'utf8');
 assert.match(html,/Лендинги в один запрос/);assert.match(html,/department-device-benefits/);
 assert.doesNotMatch(html,/ltBlock\d+|data-calendar-(?:offer|popup|block)="[^"]+"/);
});
