'use strict';
// Capture the existing product through its real UI. No request mocking or result injection.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const OUT=process.env.DEMO_MEDIA_DIR||path.join(require('node:os').homedir(),'Desktop','华销智策-demo制作素材-20261023');
const ORIGIN=process.env.DEMO_ORIGIN||'http://127.0.0.1:18796';
const DRY=process.argv.includes('--dry-run');
const scenes=JSON.parse(fs.readFileSync(path.join(OUT,'scenes-timed.json'),'utf8'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const evidence=[],downloads=[],errors=[],timeline=[];
let page,context,browser,epoch,start,sceneStart,sceneDuration,mx=800,my=400;

async function move(x,y){
 const ox=mx,oy=my;
 for(let i=1;i<=15;i++) {const t=i/15,u=t*t*(3-2*t); await page.mouse.move(ox+(x-ox)*u,oy+(y-oy)*u);if(!DRY)await sleep(12);}
 mx=x;my=y;
}
async function focus(locator,top=120){
 await locator.waitFor({state:'visible'});
 const box=await locator.boundingBox();
 const max=await page.evaluate(()=>Math.max(0,document.documentElement.scrollHeight-innerHeight));
 const sy=await page.evaluate(()=>scrollY);
 const target=Math.max(0,Math.min(max,sy+box.y-top));
 const delta=target-sy;
 if(Math.abs(delta)>18){
  await move(1570,350);
  for(let i=0;i<8;i++){await page.mouse.wheel(0,delta/8);await sleep(DRY?10:35);}
  await sleep(DRY?150:450);
 }
}
async function click(locator,options={}){
 const l=typeof locator==='string'?page.locator(locator):locator;
 await l.waitFor({state:'visible'});
 let b=await l.boundingBox();
 if(b.y<85||b.y+b.height>700){await focus(l,180);b=await l.boundingBox();}
 await move(b.x+b.width/2,b.y+b.height/2);
 await page.mouse.click(mx,my);
 await sleep(DRY?80:350);
}
async function type(locator,text,delay=48){
 await click(locator);
 for(const char of text){await page.keyboard.insertText(char);if(!DRY)await sleep(delay);}
}
async function snap(id){await page.screenshot({path:path.join(OUT,DRY?'dry-checks':'checks',id+'.png')});}
async function hold(seconds){if(!DRY)await sleep(seconds*1000);}
async function nearEnd(seconds=1.5){if(!DRY)await sleep(Math.max(0,sceneDuration*1000-(Date.now()-sceneStart)-seconds*1000));}
async function scene(id,action){
 const spec=scenes.find(s=>s.id===id);sceneStart=Date.now();sceneDuration=spec.duration;
 if(start===undefined)start=sceneStart;
 const at=(sceneStart-start)/1000;
 console.log('SCENE',id,at.toFixed(2));
 await action();
 await snap(id);
 if(!DRY)await sleep(Math.max(0,spec.duration*1000-(Date.now()-sceneStart)));
 timeline.push({...spec,start:at,end:(Date.now()-start)/1000});
 fs.writeFileSync(path.join(OUT,DRY?'dry-timeline.json':'timeline.json'),JSON.stringify({raw_start:(start-epoch)/1000,scenes:timeline,errors,downloads},null,2));
}
async function image(index,label){
 const fig=page.locator('#content-draft figure').nth(index);
 await focus(fig,145);await hold(.35);
 const img=fig.locator('img');
 await img.evaluate(async e=>{await e.decode();if(!e.naturalWidth)throw Error('Image not decoded');});
 evidence.push({label,...await img.evaluate(e=>({caption:e.alt,width:e.naturalWidth,height:e.naturalHeight,visible:e.getBoundingClientRect().top>=65&&e.getBoundingClientRect().bottom<=innerHeight-50}))});
 await snap(label);await hold(2.0);
}

async function main(){
 fs.mkdirSync(path.join(OUT,DRY?'dry-checks':'checks'),{recursive:true});
 browser=await chromium.launch({headless:true});
 context=await browser.newContext({viewport:{width:1600,height:760},deviceScaleFactor:1,locale:'zh-CN',timezoneId:'Asia/Shanghai',acceptDownloads:true,permissions:['clipboard-read','clipboard-write'],...(DRY?{}:{recordVideo:{dir:path.join(OUT,'raw'),size:{width:1600,height:760}}})});
 await context.addInitScript(()=>{
  document.addEventListener('DOMContentLoaded',()=>{
   const cursor=document.createElement('div');cursor.className='demo-rec-cursor';cursor.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40"><path d="M3 2L4 31L11 24L17 37L23 34L17 22L28 21Z" fill="#172337" stroke="white" stroke-width="2.4" stroke-linejoin="round"/></svg>';
   Object.assign(cursor.style,{position:'fixed',left:'0',top:'0',width:'29px',height:'37px',zIndex:'2147483647',pointerEvents:'none',filter:'drop-shadow(1px 2px 2px #0005)',transform:'translate(800px,400px)'});
   const ring=document.createElement('div');ring.className='demo-rec-ring';Object.assign(ring.style,{position:'fixed',width:'38px',height:'38px',border:'3px solid #e4002b',borderRadius:'50%',pointerEvents:'none',zIndex:'2147483646',opacity:'0',transform:'translate(-50%,-50%)',transition:'opacity .14s'});document.body.append(ring,cursor);
   const dialog=document.getElementById('content-view-dialog');
   const cursor2=cursor.cloneNode(true),ring2=ring.cloneNode(true);if(dialog)dialog.append(ring2,cursor2);
   document.addEventListener('mousemove',e=>{for(const c of [cursor,cursor2])c.style.transform=`translate(${e.clientX}px,${e.clientY}px)`;});
   document.addEventListener('mousedown',e=>{for(const r of [ring,ring2]){r.style.left=e.clientX+'px';r.style.top=e.clientY+'px';r.style.opacity='1';}setTimeout(()=>{ring.style.opacity=ring2.style.opacity='0';},430);});
  });
 });
 epoch=Date.now();page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('download',async d=>{const file=path.join(OUT,'downloads',d.suggestedFilename());await d.saveAs(file);downloads.push({name:d.suggestedFilename(),bytes:fs.statSync(file).size});});
 const username='销售演示_'+Date.now().toString().slice(-6),password=crypto.randomBytes(16).toString('base64url');
 const reg=await context.request.post(ORIGIN+'/api/auth/register',{headers:{Origin:ORIGIN},data:{username,password}});
 if(!reg.ok())throw Error('Isolated demo registration failed: '+reg.status());
 await page.goto(ORIGIN);await sleep(1700);await page.mouse.move(mx,my);
 const cursorStyle=await page.locator('body > .demo-rec-cursor').evaluate(e=>({position:getComputedStyle(e).position,width:getComputedStyle(e).width}));
 if(cursorStyle.position!=='fixed'||cursorStyle.width!=='29px')throw Error('Cursor visualization unavailable: '+JSON.stringify(cursorStyle));
 await snap('cursor-check');
 await scene('welcome',async()=>{await hold(2.0);await move(370,445);await hold(2.0);});
 await scene('login',async()=>{await click('#welcome-enter');await type('#auth-username',username,65);await type('#auth-password',password,45);await hold(.7);await click('#auth-submit');await page.locator('#app-shell').waitFor({state:'visible'});await sleep(700);});
 await scene('opening',async()=>{await focus(page.locator('#profile-opening'),260);await type('#profile-opening','个人客户，自由职业创作者，只买一台笔记本。通勤、咖啡馆和家中改稿，希望顺利编辑文稿并导出文件。',55);await hold(1.0);});
 await scene('preset',async()=>{await focus(page.locator('#demo-title'));await click('#demo-auto');await click('#demo-creator');await focus(page.locator('#profile-question-panel'),190);});
 for(let i=1;i<=6;i++){
  await scene('round'+i,async()=>{
   await focus(page.locator('#profile-question-panel'),170);await hold(1.0);
   await click('#demo-next');
   await focus(page.locator('#profile-question-panel'),170);await hold(2.4);
   const answer=await page.locator('#profile-answer').inputValue();if(!answer)throw Error('Missing round answer '+i);
   await nearEnd(1.5);await click('#profile-answer-button');await sleep(400);
   if(i<6)await focus(page.locator('#profile-question-panel'),170);
  });
 }
 await scene('profile',async()=>{await focus(page.locator('#profile-result'),100);await hold(3);await focus(page.locator('#profile-fields'),105);await hold(2);});
 await scene('match',async()=>{await click('#profile-to-match');await sleep(800);await focus(page.locator('#match-form'),130);await hold(2);await focus(page.locator('#match-summary'),115);});
 let chosen;
 await scene('evidence',async()=>{
  // The first card is the candidate associated with the product's saved content set.
  chosen=page.locator('#match-candidates .match-card').first();
  await focus(chosen,105);await hold(2.0);
  await click(chosen.locator('details > summary').first());await focus(chosen.locator('.match-evidence').first(),120);await hold(2.5);
 });
 await scene('content',async()=>{await click(chosen.locator('.content-generate-candidate'));await sleep(700);await focus(page.locator('#content-studio'),110);await hold(1.7);await click('#content-platform');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await sleep(600);});
 await scene('xhs1',async()=>{await focus(page.locator('#content-draft'),110);await hold(2.0);await image(0,'xhs-image-1');});
 await scene('xhs2',async()=>{await image(1,'xhs-image-2');await image(2,'xhs-image-3');});
 await scene('wechat',async()=>{await focus(page.locator('#content-studio'),105);await click('#content-platform');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');await sleep(600);await focus(page.locator('#content-draft'),105);await hold(.7);for(let i=0;i<4;i++)await image(i,'wechat-image-'+(i+1));});
 await scene('moments',async()=>{await focus(page.locator('#content-studio'),105);await click('#content-platform');await page.keyboard.press('End');await page.keyboard.press('Enter');await sleep(600);await focus(page.locator('#content-draft'),100);await hold(1.0);await image(0,'moments-image-1');});
 await scene('verification',async()=>{await focus(page.locator('#content-verification-summary'),105);await hold(2);await focus(page.locator('#content-verification-items'),110);await hold(3);await focus(page.locator('#content-safe-version'),115);});
 await scene('copy',async()=>{await click('#content-view-all');await hold(2);await click('#content-view-copy-all');await hold(1.5);await click('#content-view-close-bottom');});
 await scene('quote',async()=>{await click(page.locator('.wizard-step[data-step-target="4"]'));await sleep(800);await focus(page.locator('#diagnostics > .result-card').first(),110);await hold(2.0);});
 await scene('plan',async()=>{await focus(page.locator('#plan'),125);await hold(2);const items=page.locator('#plan li');if(await items.count())await focus(items.nth(Math.min(4,(await items.count())-1)),125);});
 await scene('actions',async()=>{await focus(page.locator('#actions'),110);await hold(3);await page.mouse.wheel(0,330);await hold(2.5);});
 await scene('export',async()=>{await click('#download-markdown');await hold(1.5);await focus(page.locator('#results-heading'),120);});
 await scene('closing',async()=>{await click(page.locator('.wizard-step[data-step-target="1"]'));await sleep(600);await focus(page.locator('#profile-result'),110);await hold(2);});
 const video=DRY?null:page.video();
 fs.writeFileSync(path.join(OUT,DRY?'dry-image-evidence.json':'image-evidence.json'),JSON.stringify(evidence,null,2));
 await context.close();
 if(video){const raw=await video.path();fs.writeFileSync(path.join(OUT,'raw-video-path.txt'),raw);console.log('RAW_VIDEO',raw);}
 await browser.close();
 if(errors.length)throw Error('Browser errors: '+errors.join('; '));
 if(evidence.length!==8||evidence.some(e=>!e.visible))throw Error('Images not all fully visible: '+JSON.stringify(evidence));
 console.log('COMPLETE',timeline.length,'scenes',evidence.length,'images',downloads.length,'downloads');
}
main().catch(async e=>{console.error(e.stack);try{if(page)await page.screenshot({path:path.join(OUT,'failure.png')});if(context)await context.close();if(browser)await browser.close();}catch{}process.exitCode=1;});
