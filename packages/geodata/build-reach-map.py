import json, pathlib, re
css = pathlib.Path('/home/user/HFKit/packages/theme/dist/tokens.css').read_text()
def block(sel):
    m=re.search(re.escape(sel)+r'\s*\{(.*?)\n\}', css, re.S); return m.group(1).strip() if m else ''
prim,dark,light,night = block(':root'), block('[data-theme="field-dark"]'), block('[data-theme="field-light"]'), block('[data-theme="night-ops"]')
bridged = f""":root {{
{prim}
{dark}
}}
@media (prefers-color-scheme: light) {{ :root:not([data-theme="dark"]) {{
{light}
}} }}
:root[data-theme="light"] {{
{light}
}}
:root[data-theme="dark"] {{
{dark}
}}
[data-app-theme="field-dark"] {{
{dark}
}}
[data-app-theme="field-light"] {{
{light}
}}
[data-app-theme="night-ops"] {{
{night}
}}
"""
cov   = pathlib.Path('/tmp/coverage2.json').read_text()
gaz   = pathlib.Path('/tmp/gaz_small.json').read_text()
coast = json.dumps(json.loads(pathlib.Path('/home/user/HFKit/packages/geodata/data/coastline.geojson').read_text()), separators=(',',':'))

html = "<title>HFKit — reach map</title>\n<style>\n" + bridged + """
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--hf-surface-default);color:var(--hf-text-primary);
  font-family:var(--hf-font-family-sans);line-height:1.5;-webkit-font-smoothing:antialiased}
.app{max-width:1240px;margin:0 auto;padding:clamp(14px,3.5vw,36px);
  display:flex;flex-direction:column;gap:var(--hf-spacing-5)}
.hd{display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--hf-border-subtle);
  padding-bottom:var(--hf-spacing-4)}
h1{margin:0;font-size:clamp(20px,3vw,28px);letter-spacing:-.01em;text-wrap:balance}
h2{margin:0 0 var(--hf-spacing-2);font-size:var(--hf-font-size-sm);text-transform:uppercase;
  letter-spacing:.06em;color:var(--hf-text-muted);font-weight:var(--hf-font-weight-semibold)}
.lede{margin:0;color:var(--hf-text-secondary);max-width:66ch;font-size:var(--hf-font-size-sm)}
.note{margin:0;color:var(--hf-text-muted);max-width:72ch;font-size:var(--hf-font-size-xs)}
.ctl{display:flex;flex-wrap:wrap;gap:var(--hf-spacing-4);align-items:flex-end}
.f{display:flex;flex-direction:column;gap:4px;position:relative}
label{font-size:var(--hf-font-size-xs);text-transform:uppercase;letter-spacing:.06em;color:var(--hf-text-muted)}
select,input[type=text]{background:var(--hf-surface-sunken);color:var(--hf-text-primary);
  border:1px solid var(--hf-border-default);border-radius:var(--hf-radius-sm);
  padding:8px 10px;font-family:var(--hf-font-family-mono);font-size:var(--hf-font-size-sm)}
select:focus-visible,input:focus-visible{outline:2px solid var(--hf-focus-ring);outline-offset:2px}
input[type=range]{accent-color:var(--hf-accent-interactive);width:190px}
.hourval{font-family:var(--hf-font-family-mono);font-variant-numeric:tabular-nums;font-size:var(--hf-font-size-sm)}
.sugg{position:absolute;top:100%;left:0;z-index:20;min-width:280px;max-height:240px;overflow-y:auto;
  background:var(--hf-surface-overlay);border:1px solid var(--hf-border-default);
  border-radius:var(--hf-radius-sm);margin-top:2px;box-shadow:0 4px 14px rgba(0,0,0,.28)}
.sugg div{padding:6px 10px;font-size:var(--hf-font-size-sm);cursor:pointer}
.sugg div:hover,.sugg div[aria-selected=true]{background:var(--hf-surface-raised)}
.sugg .cc{color:var(--hf-text-muted);font-family:var(--hf-font-family-mono);font-size:var(--hf-font-size-xs)}
.mapwrap{position:relative;border:1px solid var(--hf-border-subtle);border-radius:var(--hf-radius-md);
  overflow:hidden;background:var(--hf-surface-sunken)}
canvas{display:block;width:100%;height:auto}
.zoomctl{position:absolute;right:10px;top:10px;z-index:5;display:flex;flex-direction:column;gap:4px}
.zoomctl button{background:var(--hf-surface-overlay);color:var(--hf-text-primary);
  border:1px solid var(--hf-border-default);border-radius:var(--hf-radius-sm);
  font-family:var(--hf-font-family-mono);font-size:var(--hf-font-size-sm);
  padding:4px 9px;cursor:pointer;line-height:1.1}
.zoomctl button:hover{border-color:var(--hf-border-strong)}
.zoomctl button:focus-visible{outline:2px solid var(--hf-focus-ring);outline-offset:2px}
canvas{touch-action:none;cursor:grab}
canvas.dragging{cursor:grabbing}
.readout{position:absolute;left:10px;bottom:10px;background:var(--hf-surface-overlay);
  border:1px solid var(--hf-border-default);border-radius:var(--hf-radius-sm);padding:6px 10px;
  font-family:var(--hf-font-family-mono);font-size:var(--hf-font-size-xs);white-space:pre;
  font-variant-numeric:tabular-nums;pointer-events:none}
.legend{display:flex;flex-wrap:wrap;gap:var(--hf-spacing-4);align-items:center;
  font-size:var(--hf-font-size-xs);color:var(--hf-text-muted)}
.chip{display:inline-flex;align-items:center;gap:6px}
.sw{width:13px;height:13px;border-radius:3px;border:1px solid var(--hf-border-default)}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:var(--hf-font-size-xs);
  font-family:var(--hf-font-family-mono);font-variant-numeric:tabular-nums}
th,td{padding:6px 8px;text-align:right;border-bottom:1px solid var(--hf-border-subtle);white-space:nowrap}
th{color:var(--hf-text-muted);font-weight:var(--hf-font-weight-semibold);text-align:right;
  border-bottom:1px solid var(--hf-border-default)}
th:first-child,td:first-child{text-align:left}
td.name{font-family:var(--hf-font-family-sans);color:var(--hf-text-primary)}
.pill{display:inline-block;padding:1px 7px;border-radius:var(--hf-radius-full);
  font-weight:var(--hf-font-weight-semibold);font-size:var(--hf-font-size-xs)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;
  border:1px solid var(--hf-border-default);vertical-align:middle}
.rm{background:none;border:1px solid var(--hf-border-default);color:var(--hf-text-muted);
  border-radius:var(--hf-radius-sm);cursor:pointer;padding:1px 8px;font-size:var(--hf-font-size-xs)}
.rm:hover{color:var(--hf-text-primary);border-color:var(--hf-border-strong)}
.empty{color:var(--hf-text-muted);font-size:var(--hf-font-size-sm);padding:var(--hf-spacing-3) 0}
footer{border-top:1px solid var(--hf-border-subtle);padding-top:var(--hf-spacing-4);
  color:var(--hf-text-muted);font-size:var(--hf-font-size-xs);display:flex;flex-direction:column;gap:6px}
code{font-family:var(--hf-font-family-mono);color:var(--hf-text-secondary)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="app" id="app" data-app-theme="auto">
  <header class="hd">
    <h1>Reach map</h1>
    <p class="lede">Where a station can be heard, and how each specific circuit behaves.
      Add receivers to draw the paths and read the usable band range for each one.</p>
    <p class="note">Real ITU-R P.533 predictions on a 6&deg; grid &mdash; 1,620 points per
      transmitter, every point evaluated across all nine bands. August, SSN&nbsp;60,
      24&nbsp;dB required SNR in 3&nbsp;kHz.</p>
  </header>

  <div class="ctl">
    <div class="f"><label for="site">Transmitting from</label><select id="site"></select></div>
    <div class="f"><label for="station">Station</label><select id="station">
      <option value="0">100 W, isotropic</option><option value="2">100 W + dipole</option>
      <option value="12" selected>1 kW + dipole</option><option value="18">1 kW + 3-el beam</option>
    </select></div>
    <div class="f"><label for="mode">Colour by</label><select id="mode">
      <option value="margin">Signal margin</option><option value="band">Best band</option>
      <option value="muf">Path MUF</option></select></div>
    <div class="f"><label for="hour">Hour (UTC)</label>
      <div style="display:flex;gap:10px;align-items:center">
        <input id="hour" type="range" min="0" max="3" step="1" value="2">
        <span class="hourval" id="hourval">12Z</span></div></div>
    <div class="f"><label for="daylight">Daylight</label><select id="daylight">
      <option value="1" selected>Show</option><option value="0">Hide</option></select></div>
    <div class="f"><label for="theme">Theme</label><select id="theme">
      <option value="auto">match viewer</option><option value="field-dark">field-dark</option>
      <option value="field-light">field-light</option><option value="night-ops">night-ops</option>
    </select></div>
  </div>

  <div class="ctl">
    <div class="f" style="flex:1;min-width:260px">
      <label for="rx">Add a receiver</label>
      <input id="rx" type="text" autocomplete="off" placeholder="Guam, Manila, Honolulu&hellip;">
      <div class="sugg" id="sugg" hidden></div>
    </div>
  </div>

  <div class="mapwrap">
    <div class="zoomctl">
      <button id="zin"  aria-label="Zoom in">+</button>
      <button id="zout" aria-label="Zoom out">&minus;</button>
      <button id="zrst" aria-label="Reset view">reset</button>
    </div>
    <canvas id="cv" width="1440" height="648"></canvas>
    <div class="readout" id="ro">Hover the map</div>
  </div>

  <div class="legend" id="lg"></div>

  <div>
    <h2>Circuits</h2>
    <div class="scroll"><table id="tbl"></table></div>
    <div class="empty" id="empty">No receivers yet &mdash; search above to add one.</div>
  </div>

  <footer>
    <div id="explain"></div>
    <div><strong>Usable range</strong> is the lowest and highest band that meets the
      requirement on that circuit &mdash; the practical version of LUF and MUF. It is
      narrower than the raw MUF, because a frequency can be below the MUF and still be
      too weak to work.</div>
    <div><strong>The shaded half is night.</strong> The bright curve is the terminator, the
      &ldquo;grey line&rdquo; operators watch: the absorbing D layer decays quickly after
      sunset while the reflecting F layer lingers, so paths along it often run long.</div>
    <div><strong>Station setting:</strong> the grid was computed at 100&nbsp;W into isotropic
      antennas. Transmit power and transmit antenna gain add directly to the signal while
      noise at the far end is unchanged, so they shift SNR by a flat number of dB and can be
      applied exactly. <em>Receive</em> antenna gain is deliberately excluded &mdash; at HF the
      receiver is limited by external noise, so a bigger receive antenna lifts signal and
      noise together and largely cancels out of SNR.</div>
    <div>Receiver positions snap to the nearest 6&deg; grid cell (up to ~330&nbsp;km), so
      circuit figures are representative of the region rather than the exact site.</div>
    <div>Engine <code id="eng"></code>. Coastlines: Natural Earth (public domain).
      Places: GeoNames (CC&nbsp;BY&nbsp;4.0).</div>
  </footer>
</div>

<script>
const COV = """ + cov + """;
const GAZ = """ + gaz + """;
const COAST = """ + coast + """;
const $=(i)=>document.getElementById(i);
const cv=$('cv'), ctx=cv.getContext('2d');
const W=cv.width, H=cv.height, LAT=COV.lat, LON=COV.lon, NB=COV.bands.length;
const REQ=COV.requiredSnrDb;
let receivers=[];
// View transform. World coordinates are the unzoomed equirectangular canvas;
// panX/panY are the world point at the top-left of the viewport.
let zoom=1, panX=0, panY=0;
const MINZ=1, MAXZ=12;
const toWorld=(sx,sy)=>[sx/zoom+panX, sy/zoom+panY];
function clampView(){
  zoom=Math.max(MINZ,Math.min(MAXZ,zoom));
  // vertical stays inside the map; horizontal wraps, so only normalise it
  const visH=H/zoom;
  panY=Math.max(0,Math.min(H-visH,panY));
  const world=W;
  panX=((panX%world)+world)%world;
}
function zoomAt(sx,sy,factor){
  const [wx,wy]=toWorld(sx,sy);
  zoom*=factor;
  zoom=Math.max(MINZ,Math.min(MAXZ,zoom));
  panX=wx-sx/zoom; panY=wy-sy/zoom;
  clampView(); draw();
}

COV.sites.forEach((s,i)=>$('site').add(new Option(s.name,i)));
$('eng').textContent=COV.engine;

const cssv=(n)=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ramp=()=>Array.from({length:8},(_,i)=>cssv('--hf-sequential-'+i));
const statusFill=(k)=>cssv('--hf-status-'+k+'-fill');
const statusOn=(k)=>cssv('--hf-status-'+k+'-on');
function hex2rgb(h){h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');
  return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
const lerp=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
function rampColor(t){const r=ramp().map(hex2rgb);const x=Math.max(0,Math.min(1,t))*(r.length-1);
  const i=Math.floor(x);return lerp(r[i],r[Math.min(i+1,r.length-1)],x-i);}
const px=(lon)=>(lon+180)/360*W, py=(lat)=>(90-lat)/180*H;
const DEG=Math.PI/180;

function marginToken(m){if(m===null)return 'closed';
  if(m>=0)return 'good'; if(m>=-10)return 'fair'; if(m>=-25)return 'poor'; return 'closed';}
function alphaFor(m,flat){if(m===null)return 0; if(flat)return 225;
  if(m>=-20)return 235; if(m<=-50)return 0;
  return Math.round(235*Math.pow((m+50)/30,1.3));}

// nearest grid cell for an arbitrary position
function cellIndex(lat,lon){
  const r=Math.max(0,Math.min(LAT.length-1,Math.round((lat-LAT[0])/6)));
  const c=Math.max(0,Math.min(LON.length-1,Math.round((((lon+180)%360+360)%360)/6)));
  return [r,c];
}
function circuitAt(site,hi,lat,lon,gainDb){
  const [r,c]=cellIndex(lat,lon);
  const raw=site.marg[hi][r][c], muf=site.muf[hi][r][c];
  if(!raw) return null;
  const m=raw.map(v=>v===null?null:v+gainDb);
  let bi=-1,bm=null, lo=-1, hi2=-1;
  m.forEach((v,i)=>{ if(v===null)return;
    if(bm===null||v>bm){bm=v;bi=i;}
    if(v>=0){ if(lo<0) lo=i; hi2=i; } });
  return {margins:m,best:bi,bestMargin:bm,lowest:lo,highest:hi2,muf,gridLat:LAT[r],gridLon:LON[c]};
}

// great circle, interpolated along the geodesic and split at the antimeridian
function greatCircle(a,b,n=180){
  const p1=[a.lat*DEG,a.lon*DEG], p2=[b.lat*DEG,b.lon*DEG];
  const d=2*Math.asin(Math.sqrt(Math.pow(Math.sin((p1[0]-p2[0])/2),2)
    +Math.cos(p1[0])*Math.cos(p2[0])*Math.pow(Math.sin((p1[1]-p2[1])/2),2)));
  const segs=[]; let cur=[];
  let prevLon=null;
  for(let i=0;i<=n;i++){
    const f=i/n;
    let lat,lon;
    if(d===0){ lat=a.lat; lon=a.lon; }
    else{
      const A=Math.sin((1-f)*d)/Math.sin(d), B=Math.sin(f*d)/Math.sin(d);
      const x=A*Math.cos(p1[0])*Math.cos(p1[1])+B*Math.cos(p2[0])*Math.cos(p2[1]);
      const y=A*Math.cos(p1[0])*Math.sin(p1[1])+B*Math.cos(p2[0])*Math.sin(p2[1]);
      const z=A*Math.sin(p1[0])+B*Math.sin(p2[0]);
      lat=Math.atan2(z,Math.sqrt(x*x+y*y))/DEG; lon=Math.atan2(y,x)/DEG;
    }
    if(prevLon!==null && Math.abs(lon-prevLon)>180){ segs.push(cur); cur=[]; }
    cur.push([lon,lat]); prevLon=lon;
  }
  if(cur.length) segs.push(cur);
  return segs;
}
function distanceKm(a,b){
  const p1=a.lat*DEG,p2=b.lat*DEG,dl=(b.lon-a.lon)*DEG;
  return 6371*2*Math.asin(Math.sqrt(Math.pow(Math.sin((p2-p1)/2),2)
    +Math.cos(p1)*Math.cos(p2)*Math.pow(Math.sin(dl/2),2)));
}
function bearingDeg(a,b){
  const p1=a.lat*DEG,p2=b.lat*DEG,dl=(b.lon-a.lon)*DEG;
  const y=Math.sin(dl)*Math.cos(p2);
  const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (Math.atan2(y,x)/DEG+360)%360;
}

// --- solar geometry ---
const REP_DAY=227;
const solarDec=()=>23.44*Math.sin(DEG*(360/365.24)*(REP_DAY-81));
function subsolarLon(h){let l=180-15*h;while(l>180)l-=360;while(l<-180)l+=360;return l;}
function termLat(lon,dec,sub){const Hh=(lon-sub)*DEG,t=Math.tan(dec*DEG);
  if(Math.abs(t)<1e-6)return 0; return Math.atan(-Math.cos(Hh)/t)/DEG;}
function drawDaylight(h){
  const dec=solarDec(), sub=subsolarLon(h), nightSouth=dec>0, pts=[];
  for(let x=0;x<=W;x+=3){ pts.push([x,py(termLat((x/W)*360-180,dec,sub))]); }
  ctx.save(); ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
  for(const [x,y] of pts) ctx.lineTo(x,y);
  ctx.lineTo(W,nightSouth?H:0); ctx.lineTo(0,nightSouth?H:0); ctx.closePath();
  // multiply with a neutral cool grey: night must darken in every theme, and a
  // surface token would be near-white in the light theme.
  ctx.globalCompositeOperation='multiply'; ctx.fillStyle='rgb(122,128,146)'; ctx.fill();
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
  for(const [x,y] of pts) ctx.lineTo(x,y);
  ctx.strokeStyle=cssv('--hf-status-fair-fill'); ctx.lineWidth=2; ctx.globalAlpha=.9; ctx.stroke();
  ctx.restore();
  const sx=px(sub),sy=py(dec);
  ctx.save(); ctx.strokeStyle=cssv('--hf-status-fair-fill'); ctx.lineWidth=1.5; ctx.globalAlpha=.9;
  ctx.beginPath(); ctx.arc(sx,sy,6,0,Math.PI*2); ctx.stroke();
  for(let a=0;a<8;a++){const th=a*Math.PI/4; ctx.beginPath();
    ctx.moveTo(sx+Math.cos(th)*9,sy+Math.sin(th)*9);
    ctx.lineTo(sx+Math.cos(th)*13,sy+Math.sin(th)*13); ctx.stroke();}
  ctx.restore();
}

function draw(){
  const site=COV.sites[Number($('site').value)];
  const hi=Number($('hour').value), mode=$('mode').value, gainDb=Number($('station').value);
  $('hourval').textContent=String(COV.hours[hi]).padStart(2,'0')+'Z';
  clampView();

  const gw=LON.length, gh=LAT.length;
  const off=document.createElement('canvas'); off.width=gw; off.height=gh;
  const octx=off.getContext('2d'); const img=octx.createImageData(gw,gh);
  for(let r=0;r<gh;r++) for(let c=0;c<gw;c++){
    const o=((gh-1-r)*gw+c)*4;
    const raw=site.marg[hi][r][c], mf=site.muf[hi][r][c];
    let rgb=null,a=0;
    if(raw){
      let bi=-1,bm=null;
      raw.forEach((v,i)=>{ if(v===null)return; const x=v+gainDb; if(bm===null||x>bm){bm=x;bi=i;} });
      if(mode==='band'){ if(bi>=0){ rgb=rampColor(bi/(NB-1)); a=alphaFor(bm); } }
      else if(mode==='margin'){ if(bm!==null){ rgb=hex2rgb(statusFill(marginToken(bm))); a=225; } }
      else if(mf!==null){ rgb=rampColor((mf-3)/27); a=225; }
    }
    if(rgb){img.data[o]=rgb[0];img.data[o+1]=rgb[1];img.data[o+2]=rgb[2];img.data[o+3]=a;}
  }
  octx.putImageData(img,0,0);

  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle=cssv('--hf-surface-sunken'); ctx.fillRect(0,0,W,H);

  // Longitude wraps, so the world is drawn three times side by side. Panning
  // east past the antimeridian then continues seamlessly instead of hitting a
  // wall -- which matters here, because a Pacific transmitter's most useful
  // view straddles the date line.
  const tx={lat:site.lat,lon:site.lon};
  const lw=1/zoom;                                   // keep strokes ~1 CSS px
  for(const dx of [-W,0,W]){
    // skip copies entirely outside the viewport
    const left=(dx-panX)*zoom, right=left+W*zoom;
    if(right<0||left>W) continue;
    ctx.setTransform(zoom,0,0,zoom,(dx-panX)*zoom,-panY*zoom);

    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.drawImage(off,0,0,gw,gh,0,0,W,H);

    if($('daylight').value==='1') drawDaylight(COV.hours[hi]);

    ctx.strokeStyle=cssv('--hf-text-muted'); ctx.lineWidth=lw; ctx.globalAlpha=.55; ctx.beginPath();
    for(const f of COAST.features){
      const g=f.geometry, lines=g.type==='LineString'?[g.coordinates]:g.coordinates;
      for(const line of lines){ let started=false,prev=null;
        for(const [lo,la] of line){ const x=px(lo),y=py(la);
          if(prev!==null&&Math.abs(x-prev)>W*0.5) started=false;
          if(!started){ctx.moveTo(x,y);started=true;} else ctx.lineTo(x,y); prev=x; } }
    }
    ctx.stroke(); ctx.globalAlpha=1;

    ctx.strokeStyle=cssv('--hf-border-subtle'); ctx.globalAlpha=.5;
    ctx.lineWidth=lw; ctx.beginPath();
    for(let la=-60;la<=60;la+=30){ctx.moveTo(0,py(la));ctx.lineTo(W,py(la));}
    for(let lo=-120;lo<=120;lo+=60){ctx.moveTo(px(lo),0);ctx.lineTo(px(lo),H);}
    ctx.stroke(); ctx.globalAlpha=1;

    for(const rx of receivers){
      const c=circuitAt(site,hi,rx.lat,rx.lon,gainDb);
      const tok=c?marginToken(c.bestMargin):'closed';
      ctx.save();
      ctx.strokeStyle=statusFill(tok); ctx.lineWidth=3/zoom; ctx.globalAlpha=.95;
      ctx.lineJoin='round'; ctx.lineCap='round';
      for(const seg of greatCircle(tx,rx)){
        ctx.beginPath();
        seg.forEach(([lo,la],i)=> i?ctx.lineTo(px(lo),py(la)):ctx.moveTo(px(lo),py(la)));
        ctx.stroke();
      }
      ctx.fillStyle=statusFill(tok); ctx.strokeStyle=cssv('--hf-text-primary');
      ctx.lineWidth=1.5/zoom;
      ctx.beginPath(); ctx.arc(px(rx.lon),py(rx.lat),6/zoom,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    const sx=px(site.lon), sy=py(site.lat), r=9/zoom, arm=15/zoom;
    ctx.strokeStyle=cssv('--hf-accent-interactive'); ctx.lineWidth=2.5/zoom;
    ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx-arm,sy); ctx.lineTo(sx+arm,sy);
    ctx.moveTo(sx,sy-arm); ctx.lineTo(sx,sy+arm); ctx.stroke();
  }
  ctx.setTransform(1,0,0,1,0,0);

  drawLegend(mode); renderTable();
  $('explain').textContent = mode==='margin'
    ? 'Map colour is how much SNR the best band has to spare against the ' + REQ + ' dB requirement.'
    : mode==='band' ? 'Map colour is the best band; opacity carries how much margin it has.'
    : 'Map colour is the maximum usable frequency over the path to that point.';
}

function drawLegend(mode){
  const lg=$('lg'); lg.replaceChildren();
  if(mode==='margin'){
    for(const [k,t] of [['good','meets the requirement'],['fair','within 10 dB'],
                        ['poor','10\\u201325 dB short'],['closed','well short / no path']]){
      const c=document.createElement('span'); c.className='chip';
      const s=document.createElement('span'); s.className='sw'; s.style.background=statusFill(k);
      c.append(s,document.createTextNode(t)); lg.append(c);} return;
  }
  const wrap=document.createElement('span'); wrap.style.display='flex';
  const n=mode==='band'?NB:8;
  for(let i=0;i<n;i++){const [r,g,b]=rampColor(i/(n-1));
    const e=document.createElement('span'); e.style.cssText=
      `width:26px;height:13px;background:rgb(${r},${g},${b});border:1px solid var(--hf-border-subtle)`;
    wrap.append(e);}
  const a=document.createElement('span'),z=document.createElement('span');
  a.textContent=mode==='band'?COV.bands[0]:'3 MHz'; z.textContent=mode==='band'?COV.bands[NB-1]:'30 MHz';
  lg.append(a,wrap,z);
}

function renderTable(){
  const site=COV.sites[Number($('site').value)];
  const hi=Number($('hour').value), gainDb=Number($('station').value);
  const tx={lat:site.lat,lon:site.lon};
  const t=$('tbl'); t.replaceChildren();
  $('empty').hidden = receivers.length>0;
  if(!receivers.length) return;
  const head=t.createTHead().insertRow();
  for(const h of ['Receiver','Distance','Bearing','Path MUF','Usable range','Best band','Margin',''])
    head.insertCell().outerHTML=`<th scope="col">${h}</th>`;
  const tb=t.createTBody();
  for(const rx of receivers){
    const c=circuitAt(site,hi,rx.lat,rx.lon,gainDb);
    const tr=tb.insertRow();
    const tok=c?marginToken(c.bestMargin):'closed';
    const nm=tr.insertCell(); nm.className='name';
    nm.innerHTML=`<span class="dot" style="background:${statusFill(tok)}"></span>`+
      `${rx.name} <span style="color:var(--hf-text-muted)">${rx.cc}</span>`;
    tr.insertCell().textContent=Math.round(distanceKm(tx,rx)).toLocaleString()+' km';
    tr.insertCell().textContent=Math.round(bearingDeg(tx,rx)).toString().padStart(3,'0')+'\\u00b0';
    tr.insertCell().textContent=c&&c.muf!==null?c.muf.toFixed(1)+' MHz':'\\u2014';
    const ur=tr.insertCell();
    ur.textContent = c&&c.lowest>=0 ? `${COV.bands[c.lowest]}\\u2013${COV.bands[c.highest]}` : 'none usable';
    if(!(c&&c.lowest>=0)) ur.style.color='var(--hf-text-muted)';
    tr.insertCell().textContent=c&&c.best>=0?COV.bands[c.best]:'\\u2014';
    const mg=tr.insertCell();
    if(c&&c.bestMargin!==null){
      const s=document.createElement('span'); s.className='pill';
      s.style.background=statusFill(tok); s.style.color=statusOn(tok);
      s.textContent=(c.bestMargin>0?'+':'')+c.bestMargin+' dB'; mg.append(s);
    } else mg.textContent='\\u2014';
    const rmc=tr.insertCell();
    const b=document.createElement('button'); b.className='rm'; b.textContent='remove';
    b.setAttribute('aria-label','Remove '+rx.name);
    b.onclick=()=>{receivers=receivers.filter(x=>x!==rx); draw();};
    rmc.append(b);
  }
}

// --- receiver search over the bundled gazetteer ---
const PLACES=GAZ.places;
$('rx').addEventListener('input',()=>{
  const q=$('rx').value.trim().toLowerCase();
  const s=$('sugg');
  if(q.length<2){ s.hidden=true; return; }
  const starts=[],contains=[];
  for(const p of PLACES){
    const n=p[0].toLowerCase();
    if(n.startsWith(q)) starts.push(p);
    else if(n.includes(q)) contains.push(p);
    if(starts.length>=12) break;
  }
  const hits=[...starts,...contains].slice(0,12);
  s.replaceChildren();
  if(!hits.length){ s.hidden=true; return; }
  for(const p of hits){
    const d=document.createElement('div'); d.setAttribute('role','option');
    d.innerHTML=`${p[0]} <span class="cc">${p[1]} &middot; ${p[3].toFixed(1)}, ${p[4].toFixed(1)}</span>`;
    d.onclick=()=>{
      if(!receivers.some(r=>r.name===p[0]&&r.cc===p[1]))
        receivers.push({name:p[0],cc:p[1],lat:p[3],lon:p[4]});
      $('rx').value=''; s.hidden=true; draw();
    };
    s.append(d);
  }
  s.hidden=false;
});
$('rx').addEventListener('blur',()=>setTimeout(()=>$('sugg').hidden=true,180));

function eventLonLat(e){
  const r=cv.getBoundingClientRect();
  // CSS pixels -> canvas pixels -> world -> lon/lat
  const cx=(e.clientX-r.left)*(W/r.width), cy=(e.clientY-r.top)*(H/r.height);
  const [wx,wy]=toWorld(cx,cy);
  let lon=(wx/W)*360-180; lon=((lon+180)%360+360)%360-180;
  const lat=Math.max(-90,Math.min(90,90-(wy/H)*180));
  return [lon,lat];
}
cv.addEventListener('mousemove',(e)=>{
  if(dragging) return;
  const [lon,lat]=eventLonLat(e);
  const site=COV.sites[Number($('site').value)], hi=Number($('hour').value);
  const c=circuitAt(site,hi,lat,lon,Number($('station').value));
  const pos=`${Math.abs(lat).toFixed(0)}\\u00b0${lat<0?'S':'N'}  ${Math.abs(lon).toFixed(0)}\\u00b0${lon<0?'W':'E'}`;
  $('ro').textContent = !c ? pos+'\\nno path predicted'
    : pos+`\\nbest ${COV.bands[c.best]}  ${c.bestMargin>0?'+':''}${c.bestMargin} dB`
      +(c.muf!==null?`\\nMUF ${c.muf.toFixed(1)} MHz`:'')
      +(c.lowest>=0?`\\nusable ${COV.bands[c.lowest]}\\u2013${COV.bands[c.highest]}`:'\\nnone usable');
});
cv.addEventListener('mouseleave',()=>$('ro').textContent='Hover the map');

// --- pan, zoom, touch ---
let dragging=false, lastX=0, lastY=0, pinchDist=null;
cv.addEventListener('pointerdown',(e)=>{
  dragging=true; lastX=e.clientX; lastY=e.clientY;
  cv.classList.add('dragging'); cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove',(e)=>{
  if(!dragging) return;
  const r=cv.getBoundingClientRect();
  panX-=(e.clientX-lastX)*(W/r.width)/zoom;
  panY-=(e.clientY-lastY)*(H/r.height)/zoom;
  lastX=e.clientX; lastY=e.clientY;
  draw();
});
for(const ev of ['pointerup','pointercancel','pointerleave'])
  cv.addEventListener(ev,(e)=>{ dragging=false; cv.classList.remove('dragging'); });
cv.addEventListener('wheel',(e)=>{
  e.preventDefault();
  const r=cv.getBoundingClientRect();
  zoomAt((e.clientX-r.left)*(W/r.width),(e.clientY-r.top)*(H/r.height),
         e.deltaY<0?1.15:1/1.15);
},{passive:false});
cv.addEventListener('dblclick',(e)=>{
  const r=cv.getBoundingClientRect();
  zoomAt((e.clientX-r.left)*(W/r.width),(e.clientY-r.top)*(H/r.height),1.8);
});
cv.addEventListener('touchmove',(e)=>{
  if(e.touches.length!==2) return;
  e.preventDefault();
  const [a,b]=e.touches;
  const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  if(pinchDist!==null){
    const r=cv.getBoundingClientRect();
    zoomAt(((a.clientX+b.clientX)/2-r.left)*(W/r.width),
           ((a.clientY+b.clientY)/2-r.top)*(H/r.height), d/pinchDist);
  }
  pinchDist=d;
},{passive:false});
cv.addEventListener('touchend',()=>{ pinchDist=null; });
$('zin').onclick =()=>zoomAt(W/2,H/2,1.6);
$('zout').onclick=()=>zoomAt(W/2,H/2,1/1.6);
$('zrst').onclick=()=>{ zoom=1; panX=0; panY=0; draw(); };

for(const id of ['site','mode','hour','station','daylight']) $(id).addEventListener('input',draw);
$('theme').addEventListener('change',(e)=>{$('app').setAttribute('data-app-theme',e.target.value);draw();});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',draw);

// start on Sydney with the Pacific receivers, since that is the example that
// prompted this view
$('site').value=String(COV.sites.findIndex(s=>s.id==='sydney'));
for(const [n,cc,la,lo] of [['Dededo Village','GU',13.518,144.839],
                           ['Manila','PH',14.604,120.982],
                           ['Honolulu','US',21.307,-157.858]])
  receivers.push({name:n,cc,lat:la,lon:lo});
// open zoomed on the transmitter's region rather than the whole globe
(function(){
  const s=COV.sites[Number($('site').value)];
  zoom=2.2; panX=px(s.lon)-(W/zoom)/2; panY=py(s.lat)-(H/zoom)/2;
})();
draw();
</script>
"""
pathlib.Path('/home/user/HFKit/apps/web/reach.html').write_text(html)
print('reach.html', round(len(html)/1024), 'KB')
