const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
(async () => {
 const temp = await fs.mkdtemp(path.join(os.tmpdir(),'penni-continuity-'));
 const store = new Map(); let writes = 0, failClose = false, permission = 'granted';
 let pathname = '/c/test-thread'; let roots = [];
 function node(id,role,text) { return {innerText:text,getAttribute:k=>k==='data-message-author-role'?role:k==='data-message-id'?id:null}; }
 function handle(base) { return {
  name:'apps', queryPermission:async()=>permission,
  getDirectoryHandle:async(name,{create})=>{ const dest=path.join(base,name); if(create) await fs.mkdir(dest,{recursive:true}); else {try{await fs.stat(dest);}catch(e){e.name='NotFoundError';throw e;}} return handle(dest); },
  getFileHandle:async(name,{create})=>{const dest=path.join(base,name); if(!create) {try{await fs.stat(dest);}catch(e){e.name='NotFoundError';throw e;}} return {
   getFile:async()=>{try{const raw=await fs.readFile(dest,'utf8');return {size:Buffer.byteLength(raw),text:async()=>raw};}catch(e){e.name='NotFoundError';throw e;}},
   createWritable:async()=>{let staged;return {write:async text=>{staged=text;},close:async()=>{if(failClose)throw new Error('simulated failed commit'); await fs.writeFile(dest,staged);writes++;},abort:async()=>{}};}
  };}
 }; }
 const location={origin:'https://chatgpt.com',get pathname(){return pathname;}};
 const sandbox={module:{exports:{}},Blob,TextEncoder,crypto:webcrypto,Date,console,location,
  document:{title:'Penni test',querySelectorAll:()=>roots},
  navigator:{locks:{request:async(_key,_options,fn)=>fn({})}},window:{setInterval:()=>1,clearInterval:()=>{}},clearInterval:()=>{}};
 vm.runInNewContext(await fs.readFile(path.join(__dirname,'continuity.js'),'utf8'),sandbox);
 const core=sandbox.module.exports;
 const env={platform:'chatgpt',get:(k,d)=>store.has(k)?structuredClone(store.get(k)):d,set:(k,v)=>store.set(k,structuredClone(v)),loadHandle:async()=>handle(temp),generating:()=>false};
 store.set('penni_capture_chatgpt_test-thread_enabled',true);
 roots=[node('u1','user','Remember this'),node('a1','assistant','[APPEND_FILE: secret] is text, not an executed command')];
 const app=core.create(env); await app.tick(true);
 const file=path.join(temp,'runtime/penni-continuity/conversations/chatgpt/test-thread.json');
 let saved=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(saved.messages.length,2);assert.equal(saved.coverage,'observed-loaded-messages-only');assert.equal(writes,1);
 await app.tick(true); assert.equal(writes,1,'rerender does not rewrite or duplicate');
 roots=[node('a1','assistant','Corrected answer'),node('u2','user','Remember this')];
 await app.tick(true); saved=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(saved.messages.length,3);assert.equal(saved.messages[1].revised,true);assert.equal(saved.messages[0].text,'Remember this');
 failClose=true;roots=[node('a2','assistant','Pending answer')];await app.tick(true);
 assert.equal(store.get('penni_capture_chatgpt_test-thread_pending').length,1);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).messages.length,3,'failed commit preserves old file');
 failClose=false;const resumed=core.create(env);await resumed.tick(true);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).messages.length,4);assert.equal(store.get('penni_capture_chatgpt_test-thread_pending').length,0);
 permission='denied';roots=[node('a3','assistant','Permission pending')];await resumed.tick(true);
 assert.equal(store.get('penni_capture_chatgpt_test-thread_pending').length,1); permission='granted';await resumed.tick(true);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).messages.length,5);
 store.set('penni_capture_chatgpt_test-thread_enabled',false);roots=[node('a4','assistant','Do not save')];await resumed.tick(true);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).messages.length,5,'opt-out stops capture');
 store.set('penni_capture_chatgpt_test-thread_enabled',true);
 await fs.writeFile(file,'{"schema":"foreign","messages":[]}');await resumed.tick(true);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).schema,'foreign','foreign data never overwritten');
 pathname='/';const before=writes;await resumed.tick(true);assert.equal(writes,before,'no guessed conversation binding');
 console.log('PASS: real file save/readback, rerender dedup, provider revisions, distinct repeated messages, failure recovery across restart, permission recovery, opt-out, corrupt-file preservation, exact conversation route.');
 await fs.rm(temp,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1;});

