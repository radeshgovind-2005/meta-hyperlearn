import { chromium } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';
import { readFile, mkdir } from 'node:fs/promises';
const vars = Object.fromEntries((await readFile('.dev.vars','utf8')).split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const clerk = createClerkClient({ secretKey: vars.CLERK_SECRET_KEY });
const ticket = await clerk.signInTokens.createSignInToken({userId:'user_3LYp89FmPJeSYGcFIbCw35WjhRN',expiresInSeconds:300});
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2,colorScheme:'light'});
const origin='https://hyperlearn.radesh-govind.com', course='crs_qdhs2ck5wt';
await page.goto(origin+'/sign-in');
await page.waitForFunction(()=>window.Clerk?.loaded);
await page.evaluate(async t=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:t});await window.Clerk.setActive({session:s.createdSessionId});},ticket.token);
// Change this box, typed only
await page.goto(`${origin}/courses/${course}/s/sec_lqwqofis25`);
await page.locator('.para').first().waitFor({timeout:30000}); await page.waitForTimeout(3000);
const p=page.locator('.para').first();
await p.hover(); await p.getByRole('button',{name:'Change this'}).click(); await page.waitForTimeout(800);
await page.locator('#ask').pressSequentially('This is too complex. Simplify it and give me an interactive example.',{delay:15});
await page.waitForTimeout(500); await page.screenshot({path:'video/shots/change-box.png'});
await page.keyboard.press('Escape');
// widget
await page.reload(); await page.locator('.para').first().waitFor({timeout:30000});
const fr=page.locator('iframe').first(); await fr.scrollIntoViewIfNeeded();
await page.evaluate(()=>window.scrollBy(0,-120)); await page.waitForTimeout(12000);
await page.screenshot({path:'video/shots/widget-page.png'});
const f=page.frameLocator('iframe').first();
const sliders=f.locator('input[type=range]'); const n=await sliders.count(); console.log('sliders',n);
await mkdir('video/shots/wseq',{recursive:true});
if(n){ const s=sliders.first(); const min=+(await s.getAttribute('min')??0), max=+(await s.getAttribute('max')??10), v0=+(await s.inputValue());
  const vals=[...Array(24)].map((_,i)=>v0+(max-v0)*Math.sin(Math.PI*i/23)*0.9);
  for(const [i,v] of vals.entries()){ await s.evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},v); await page.waitForTimeout(120); await fr.screenshot({path:`video/shots/wseq/${String(i).padStart(2,'0')}.png`}); }
  console.log('min',min,'max',max,'v0',v0);
}
await browser.close();
