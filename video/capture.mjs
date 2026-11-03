import { chromium } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';
import { readFile } from 'node:fs/promises';
const vars = Object.fromEntries((await readFile('.dev.vars','utf8')).split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const clerk = createClerkClient({ secretKey: vars.CLERK_SECRET_KEY });
const ticket = await clerk.signInTokens.createSignInToken({userId:'user_3LYp89FmPJeSYGcFIbCw35WjhRN',expiresInSeconds:300});
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2,colorScheme:'light'});
const origin='https://hyperlearn.radesh-govind.com';
const course='crs_qdhs2ck5wt';
const out=n=>`video/shots/${n}.png`;
await page.goto(origin+'/sign-in');
await page.waitForFunction(()=>window.Clerk?.loaded);
await page.evaluate(async t=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:t});await window.Clerk.setActive({session:s.createdSessionId});},ticket.token);
const token=await page.evaluate(()=>window.Clerk.session.getToken());
const data=await (await page.request.get(`${origin}/api/courses/${course}`,{headers:{Authorization:`Bearer ${token}`}})).json();
console.log('course:',data.course.title,'sections:',data.sections.map(s=>s.id+' '+s.title).join(' | '));
await page.goto(origin+'/library'); await page.waitForTimeout(4000); await page.screenshot({path:out('library')});
await page.goto(`${origin}/courses/${course}`); await page.waitForTimeout(4000); await page.screenshot({path:out('outline')});
for (const [i,s] of data.sections.slice(0,3).entries()) {
  await page.goto(`${origin}/courses/${course}/s/${s.id}`);
  await page.locator('.para').first().waitFor({timeout:30000}); await page.waitForTimeout(4000);
  await page.screenshot({path:out(`reader${i}`)});
  const w=page.locator('iframe, .widget').first();
  if (await w.count()) { await w.scrollIntoViewIfNeeded(); await page.waitForTimeout(3000); await page.screenshot({path:out(`widget${i}`)}); }
  await page.evaluate(()=>window.scrollTo(0,0));
  const cite=page.locator('.para sup a, .para a.cite, .para button.cite, sup button').first();
  if (await cite.count()) { await cite.click(); await page.waitForTimeout(3500); await page.screenshot({path:out(`cite${i}`)}); }
  await page.locator('.para').first().hover(); await page.waitForTimeout(500); await page.screenshot({path:out(`hover${i}`)});
}
await page.goto(`${origin}/courses/${course}/history`); await page.waitForTimeout(4000); await page.screenshot({path:out('history')});
await browser.close();
