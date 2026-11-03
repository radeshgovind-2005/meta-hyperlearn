import { open, recorder, course, origin } from './lib.mjs';
const {page,api,close}=await open();
const wait=ms=>page.waitForTimeout(ms);
const glide=async(loc,ms=600)=>{const b=await loc.boundingBox();if(b)await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:Math.round(ms/16)})};
const s=await api('POST','/api/practice',{courseId:course,chapter:'Lecture 7 — Eigenvectors and Eigenvalues',count:3}); console.log('session',s);
let r;
try{
  await page.goto(`${origin}/practice/${s.id}`);
  await page.getByRole('button',{name:/Check answer|Skip/}).first().waitFor({timeout:120000}); await wait(1500);
  r=await recorder(page,'practice'); await page.mouse.move(800,300); await wait(1500);
  for(let q=0;q<3;q++){
    r.mark('q'+q); await wait(2500);
    const main=page.locator('main');
    const ta=main.locator('textarea:visible'); const inp=main.locator('input[type=text]:visible, input:not([type]):visible, input[inputmode]:visible');
    const radios=main.locator('input[type=radio]:visible, input[type=checkbox]:visible');
    const tf=main.getByRole('button',{name:'True'});
    console.log('q',q,'ta',await ta.count(),'inp',await inp.count(),'radio',await radios.count(),'tf',await tf.count());
    if(await ta.count()){await glide(ta.first());await ta.first().click();await ta.first().pressSequentially('You add the two diagonal products, so det(A - λI) = (a - λ)(d - λ) + bc, and the eigenvalues are just a and d.',{delay:22});}
    else if(await inp.count()){for(let i=0;i<await inp.count();i++){const e=inp.nth(i);await glide(e,400);await e.click();await e.pressSequentially(i%2?'2':'ad + bc',{delay:60});}}
    else if(await radios.count()){const e=radios.first();await glide(e);await e.click({force:true});}
    else if(await tf.count()){await glide(tf);await tf.click();}
    await wait(700);
    const check=page.getByRole('button',{name:'Check answer'});
    if(await check.isEnabled().catch(()=>false)){await glide(check);await check.click();r.mark('checked'+q);}
    else {const sk=page.getByRole('button',{name:'Skip'});await glide(sk);await sk.click();r.mark('skipped'+q);await wait(2000);continue;}
    await page.getByRole('button',{name:/Next question|See results/}).first().waitFor({timeout:90000}); r.mark('graded'+q); await wait(1500);
    const keep=page.getByRole('button',{name:'Keep'});
    const replanStarted=await page.getByText(/Diagnos|Re-plan|We adjusted|already covers/).first().waitFor({timeout:8000}).then(()=>true,()=>false);
    console.log('replan started',replanStarted);
    if(replanStarted){
      const got=await Promise.race([keep.waitFor({timeout:240000}).then(()=>'keep'),page.getByText('Your course already covers this').waitFor({timeout:240000}).then(()=>'covered')]).catch(()=>'timeout');
      r.mark('replan-'+got); console.log('replan',got);
      await wait(3000);
      if(got==='keep'){await glide(keep,700);await wait(1200);const undo=page.getByRole('button',{name:'Undo'});await glide(undo,500);await wait(400);await undo.click();await page.getByText('Undone. Your course is unchanged.').waitFor({timeout:60000}).catch(()=>{});r.mark('undone');await wait(2500);break;}
      if(got==='covered'){await wait(2000);}
    }
    const nx=page.getByRole('button',{name:/Next question|See results/}).first(); await glide(nx); await nx.click(); await wait(1500);
  }
  await r.stop(); r=null; await page.screenshot({path:'video/shots/practice-end.png'});
} finally { if(r) await r.stop().catch(()=>{}); await close(); }
