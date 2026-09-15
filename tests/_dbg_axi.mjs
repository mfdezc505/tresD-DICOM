import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname); const DOCS = path.join(ROOT,'docs');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';
 const f=path.join(DOCS,p); if(!f.startsWith(DOCS)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});
await new Promise(r=>server.listen(8797,r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
 args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--no-sandbox']});
const page=await browser.newPage({viewport:{width:1500,height:900},locale:'es-ES'});
await page.addInitScript(()=>{try{localStorage.setItem('tresd_dicom_terms','v1-2026-09');}catch(e){}});
page.setDefaultTimeout(300000);
await page.goto('http://localhost:8797/'); await page.waitForTimeout(600);
await page.setInputFiles('#in-folder','/tmp/testdata/cbct_half');
await page.waitForFunction(()=>/^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent),null,{timeout:300000});
await page.waitForTimeout(1000);
await page.evaluate(()=>window.tresd.V.buildTmj({R:[-54,-24,43],L:[50,-29,45]},null));
await page.waitForFunction(()=>window.tresd.V.state.tmj,null,{timeout:300000});
const info = await page.evaluate(()=>{ const t=window.tresd.V.state.tmj; return {R:{apex:t.poles.R.apex, center:t.poles.R.center, thr:t.thr}, L:{apex:t.poles.L.apex, center:t.poles.L.center}}; });
console.log(JSON.stringify(info));
// mosaico de axiales: dz de +4 a -14 por lado
const url = await page.evaluate(()=>{
  const V=window.tresd.V; const dzs=[4,2,0,-2,-4,-6,-8,-10,-12,-14];
  const cw=180, ch=180; const out=document.createElement('canvas'); out.width=cw*dzs.length; out.height=ch*2+20; const g=out.getContext('2d');
  g.fillStyle='#000'; g.fillRect(0,0,out.width,out.height);
  const win=V.getTmjWindow();
  ['R','L'].forEach((sd,row)=>{ dzs.forEach((dz,i)=>{ const v=V.condyleAxialView(sd,18,0.2,dz); const c=document.createElement('canvas'); V.drawTmjSlice(c,v.img,win,1);
    g.drawImage(c,i*cw,row*ch+20,cw,ch); g.fillStyle='#ff0'; g.font='bold 14px sans-serif'; g.fillText(sd+' dz='+dz,i*cw+4,row*ch+16+ (row?0:0)); });
  });
  return out.toDataURL('image/png');
});
fs.writeFileSync('/tmp/axi_stack.png', Buffer.from(url.split(',')[1],'base64'));
await browser.close(); server.close();
