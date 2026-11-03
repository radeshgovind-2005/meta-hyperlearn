import { chromium } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';
import { readFile, mkdir } from 'node:fs/promises';
const vars = Object.fromEntries((await readFile('.dev.vars','utf8')).split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const clerk = createClerkClient({ secretKey: vars.CLERK_SECRET_KEY });
const ticket = await clerk.signInTokens.createSignInToken({userId:'user_3LYp89FmPJeSYGcFIbCw35WjhRN',expiresInSeconds:300});
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2,colorScheme:'light'});
const origin='https://hyperlearn.radesh-govind.com', course='crs_qdhs2ck5wt';
await page.goto(origin+'/sign-in'); await page.waitForFunction(()=>window.Clerk?.loaded);
await page.evaluate(async t=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:t});await window.Clerk.setActive({session:s.createdSessionId});},ticket.token);
for (const [name,sid] of [['plot','sec_2tg5jraa0u'],['vec','sec_7u4y7p89gw']]) {
  await page.goto(`${origin}/courses/${course}/s/${sid}`); await page.locator('.para').first().waitFor(); await page.waitForTimeout(3000);
  const w=page.locator('.widget, [class*=widget]').filter({has:page.locator('svg, canvas')}).first();
  console.log(name,'widgets',await w.count(), await page.evaluate(()=>[...document.querySelectorAll('[class*=widget]')].map(e=>e.className).slice(0,6).join(' | ')));
  if(!await w.count()) continue;
  await w.scrollIntoViewIfNeeded(); await page.evaluate(()=>window.scrollBy(0,250)); await page.waitForTimeout(1500);
  await page.screenshot({path:`video/shots/${name}-page.png`});
  await w.screenshot({path:`video/shots/${name}-widget.png`});
  const sliders=w.locator('input[type=range]'); const n=await sliders.count(); console.log(name,'sliders',n);
  if(!n) continue;
  await mkdir(`video/shots/${name}seq`,{recursive:true});
  const s=sliders.first(); const min=+(await s.getAttribute('min')), max=+(await s.getAttribute('max')), v0=+(await s.inputValue());
  const box=await s.boundingBox();
  const frac=v=>(v-min)/(max-min);
  await page.mouse.move(box.x+box.width*frac(v0), box.y+box.height/2); await page.mouse.down();
  for(let i=0;i<36;i++){ const f=frac(v0)+(0.95-frac(v0))*Math.sin(Math.PI*i/35*0.5)*1;
    await page.mouse.move(box.x+box.width*Math.min(f,0.98), box.y+box.height/2); await page.waitForTimeout(60);
    await w.screenshot({path:`video/shots/${name}seq/${String(i).padStart(2,'0')}.png`}); }
  await page.mouse.up();
}
await browser.close();
