import json, pathlib, re
css = pathlib.Path('/home/user/HFKit/packages/theme/dist/tokens.css').read_text()
def block(sel):
    m = re.search(re.escape(sel) + r'\s*\{(.*?)\n\}', css, re.S)
    return m.group(1).strip() if m else ''
prim, dark, light, night = block(':root'), block('[data-theme="field-dark"]'), block('[data-theme="field-light"]'), block('[data-theme="night-ops"]')
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
cov  = pathlib.Path('/tmp/coverage.json').read_text()
coast= json.dumps(json.loads(pathlib.Path('/home/user/HFKit/packages/geodata/data/coastline.geojson').read_text()), separators=(',',':'))

html = "<title>HFKit — reach map</title>\n<style>\n" + bridged + """
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--hf-surface-default);color:var(--hf-text-primary);
  font-family:var(--hf-font-family-sans);line-height:1.5;-webkit-font-smoothing:antialiased}
.app{max-width:1240px;margin:0 auto;padding:clamp(14px,3.5vw,36px);
  display:flex;flex-direction:column;gap:var(--hf-spacing-5)}
.hd{display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--hf-border-subtle);
  padding-bottom:var(--hf-spacing-4)}
h1{margin:0;font-size:clamp(20px,3vw,28px);letter-spacing:-.01em;text-wrap:balance}
.lede{margin:0;color:var(--hf-text-secondary);max-width:66ch;font-size:var(--hf-font-size-sm)}
.note{margin:0;color:var(--hf-text-muted);max-width:72ch;font-size:var(--hf-font-size-xs)}
.ctl{display:flex;flex-wrap:wrap;gap:var(--hf-spacing-4);align-items:flex-end}
.f{display:flex;flex-direction:column;gap:4px}
label{font-size:var(--hf-font-size-xs);text-transform:uppercase;letter-spacing:.06em;color:var(--hf-text-muted)}
select{background:var(--hf-surface-sunken);color:var(--hf-text-primary);
  border:1px solid var(--hf-border-default);border-radius:var(--hf-radius-sm);
  padding:8px 10px;font-family:var(--hf-font-family-mono);font-size:var(--hf-font-size-sm)}
select:focus-visible,input:focus-visible{outline:2px solid var(--hf-focus-ring);outline-offset:2px}
input[type=range]{accent-color:var(--hf-accent-interactive);width:210px}
.hourval{font-family:var(--hf-font-family-mono);font-variant-numeric:tabular-nums;
  color:var(--hf-text-primary);font-size:var(--hf-font-size-sm)}
.mapwrap{position:relative;border:1px solid var(--hf-border-subtle);border-radius:var(--hf-radius-md);
  overflow:hidden;background:var(--hf-surface-sunken)}
canvas{display:block;width:100%;height:auto}
.readout{position:absolute;left:10px;bottom:10px;background:var(--hf-surface-overlay);
  border:1px solid var(--hf-border-default);border-radius:var(--hf-radius-sm);
  padding:6px 10px;font-family:var(--hf-font-family-mono);font-size:var(--hf-font-size-xs);
  color:var(--hf-text-primary);pointer-events:none;font-variant-numeric:tabular-nums;
  max-width:min(320px,60%)}
.legend{display:flex;flex-wrap:wrap;gap:var(--hf-spacing-4);align-items:center;
  font-size:var(--hf-font-size-xs);color:var(--hf-text-muted)}
.ramp{display:flex;align-items:center;gap:0}
.ramp i{width:26px;height:13px;display:block;border:1px solid var(--hf-border-subtle);
  border-left:none;font-style:normal}
.ramp i:first-child{border-left:1px solid var(--hf-border-subtle)}
.chip{display:inline-flex;align-items:center;gap:6px}
.sw{width:13px;height:13px;border-radius:3px;border:1px solid var(--hf-border-default)}
footer{border-top:1px solid var(--hf-border-subtle);padding-top:var(--hf-spacing-4);
  color:var(--hf-text-muted);font-size:var(--hf-font-size-xs);display:flex;flex-direction:column;gap:6px}
code{font-family:var(--hf-font-family-mono);color:var(--hf-text-secondary)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="app" id="app" data-app-theme="auto">
  <header class="hd">
    <h1>Reach map</h1>
    <p class="lede">Where a station can actually be heard. Every point on Earth coloured by how
      well the selected site reaches it &mdash; scrub the hour and watch the footprint swing
      with the sun.</p>
    <p class="note">Real ITU-R P.533 predictions on a 6&deg; grid &mdash; 1,620 points per site,
      each evaluated across nine bands. August, SSN&nbsp;60, 24&nbsp;dB required SNR in
      3&nbsp;kHz. The station setting shifts the whole field by that setup's transmit
      advantage. Hover or tap the map to inspect a point.</p>
  </header>

  <div class="ctl">
    <div class="f"><label for="site">Transmitting from</label><select id="site"></select></div>
    <div class="f"><label for="station">Station</label><select id="station">
      <option value="0">100 W, isotropic (as computed)</option>
      <option value="2">100 W + dipole</option>
      <option value="12" selected>1 kW + dipole</option>
      <option value="18">1 kW + 3-element beam</option>
    </select></div>
    <div class="f"><label for="mode">Colour by</label><select id="mode">
      <option value="margin">Signal margin</option>
      <option value="band">Best band</option>
      <option value="muf">MUF over the path</option>
    </select></div>
    <div class="f"><label for="hour">Hour (UTC)</label>
      <div style="display:flex;gap:10px;align-items:center">
        <input id="hour" type="range" min="0" max="3" step="1" value="2">
        <span class="hourval" id="hourval">12Z</span>
      </div></div>
    <div class="f"><label for="daylight">Daylight</label><select id="daylight">
      <option value="1" selected>Show</option>
      <option value="0">Hide</option>
    </select></div>
    <div class="f"><label for="theme">Theme</label><select id="theme">
      <option value="auto">match viewer</option><option value="field-dark">field-dark</option>
      <option value="field-light">field-light</option><option value="night-ops">night-ops</option>
    </select></div>
  </div>

  <div class="mapwrap">
    <canvas id="cv" width="1440" height="648"></canvas>
    <div class="readout" id="ro">Hover the map</div>
  </div>

  <div class="legend" id="lg"></div>

  <footer>
    <div id="explain"></div>
    <div><strong>The shaded half is night.</strong> The bright line is the terminator &mdash;
      the &ldquo;grey line&rdquo; operators watch, because the D layer that absorbs low
      frequencies by day decays quickly after sunset while the reflecting F layer lingers,
      so paths along it often run unusually long. The marked point is where the sun is
      directly overhead. Compare it against the colours: the daylit side favours the higher
      bands, the dark side the lower ones.</div>
    <div><strong>About the station setting:</strong> the grid was computed at 100&nbsp;W into
      isotropic antennas. Transmit power and transmit antenna gain add directly to the
      signal while the noise at the far end is unchanged, so they shift SNR by a flat
      number of dB and can be applied exactly &mdash; 100&nbsp;W to 1&nbsp;kW is
      +10&nbsp;dB, a dipole about +2&nbsp;dB, a 3-element beam about +8&nbsp;dB.</div>
    <div><em>Receive</em> antenna gain is deliberately not included. At HF the receiver is
      limited by external noise &mdash; atmospheric, man-made and galactic &mdash; not by
      its own front end, so a bigger receive antenna lifts the signal and the noise
      together and largely cancels out of SNR. Counting it would flatter the map.</div>
    <div>Engine <code id="eng"></code>. Coastlines: Natural Earth (public domain).</div>
  </footer>
</div>

<script>
const COV = """ + cov + """;
const COAST = """ + coast + """;
const $=(i)=>document.getElementById(i);
const cv=$('cv'), ctx=cv.getContext('2d');
const W=cv.width, H=cv.height;
const LAT=COV.lat, LON=COV.lon, NB=COV.bands.length;

COV.sites.forEach((s,i)=>$('site').add(new Option(s.name,i)));
$('eng').textContent=COV.engine;

function cssv(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function ramp(){ return Array.from({length:8},(_,i)=>cssv('--hf-sequential-'+i)); }
function statusFill(k){ return cssv('--hf-status-'+k+'-fill'); }

function hex2rgb(h){ h=h.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join('');
  return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function lerp(a,b,t){ return a.map((v,i)=>Math.round(v+(b[i]-v)*t)); }
function rampColor(t){ // t in 0..1 across the 8-stop sequential ramp
  const r=ramp().map(hex2rgb); const x=Math.max(0,Math.min(1,t))*(r.length-1);
  const i=Math.floor(x); return lerp(r[i], r[Math.min(i+1,r.length-1)], x-i); }

// equirectangular
const px=(lon)=> (lon+180)/360*W;
const py=(lat)=> (90-lat)/180*H;

// --- solar geometry ------------------------------------------------------
// The grids are monthly predictions, so the 15th is the representative date.
// Declination via the standard approximation (good to a fraction of a degree);
// the equation of time is ignored, which moves the terminator by at most a few
// minutes of longitude -- invisible at this scale.
const REP_DAY_OF_YEAR = 227;              // 15 August
const DEG = Math.PI/180;
function solarDeclinationDeg(){
  return 23.44 * Math.sin(DEG * (360/365.24) * (REP_DAY_OF_YEAR - 81));
}
function subsolarLonDeg(utcHour){
  let l = 180 - 15*utcHour;
  while(l>180) l-=360; while(l<-180) l+=360;
  return l;
}
// Latitude where the sun sits exactly on the horizon, for a given longitude.
// From sin(elev)=sin(lat)sin(dec)+cos(lat)cos(dec)cos(H), set elev=0:
//   tan(lat) = -cos(H)/tan(dec)
function terminatorLatDeg(lonDeg, decDeg, subLonDeg){
  const Hh = (lonDeg - subLonDeg) * DEG;
  const t = Math.tan(decDeg*DEG);
  if(Math.abs(t) < 1e-6) return 0;         // equinox: terminator is a meridian pair
  return Math.atan(-Math.cos(Hh)/t) / DEG;
}
function drawDaylight(utcHour){
  const dec = solarDeclinationDeg(), sub = subsolarLonDeg(utcHour);
  // With dec > 0 the summer (north) pole is lit, so night lies south of the
  // curve; with dec < 0 it is the other way round.
  const nightIsSouth = dec > 0;
  const pts=[];
  for(let x=0; x<=W; x+=3){
    const lon = (x/W)*360 - 180;
    pts.push([x, py(terminatorLatDeg(lon, dec, sub))]);
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for(const [x,y] of pts) ctx.lineTo(x,y);
  ctx.lineTo(W, nightIsSouth ? H : 0);
  ctx.lineTo(0, nightIsSouth ? H : 0);
  ctx.closePath();
  // 'multiply' with a neutral, slightly cool grey rather than a themed fill.
  // Night is an absence of light, so it must darken whatever is underneath in
  // every theme -- a surface token would be near-white in the light theme and
  // would brighten the night side instead (which is exactly what it did before
  // this was caught). Compositing is a lighting operation, not a palette choice,
  // so it is deliberately theme-independent.
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgb(122,128,146)';
  ctx.fill();
  ctx.restore();

  // the terminator itself -- the "grey line", where HF often runs long
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for(const [x,y] of pts) ctx.lineTo(x,y);
  ctx.strokeStyle = cssv('--hf-status-fair-fill');
  ctx.lineWidth = 2; ctx.globalAlpha = 0.9; ctx.stroke();
  ctx.restore();

  // subsolar point
  const sx = px(sub), sy = py(dec);
  ctx.save();
  ctx.strokeStyle = cssv('--hf-status-fair-fill'); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI*2); ctx.stroke();
  for(let a=0; a<8; a++){
    const th = a*Math.PI/4;
    ctx.beginPath();
    ctx.moveTo(sx+Math.cos(th)*9, sy+Math.sin(th)*9);
    ctx.lineTo(sx+Math.cos(th)*13, sy+Math.sin(th)*13);
    ctx.stroke();
  }
  ctx.restore();
}

// Margin -> opacity. Fully opaque once the circuit meets its requirement,
// fading to nothing well below it. No hard edge.
function alphaFor(m, flat){
  if(m===null) return 0;              // genuinely no prediction -> bare map
  if(flat) return 225;                // margin mode: the colour already says "short"
  if(m>=-20) return 235;              // band mode: hold opacity through usable range
  if(m<=-50) return 0;
  return Math.round(235*Math.pow((m+50)/30, 1.3));
}
// Green = the circuit meets its requirement. The previous scheme reserved green
// for +10 dB or better, which no cell in the dataset ever reached (max +8 dB),
// so a quarter of the legend was dead and 82% of the map fell in one bin.
function marginToken(m){ if(m===null) return 'closed';
  if(m>=0) return 'good'; if(m>=-10) return 'fair'; if(m>=-25) return 'poor'; return 'closed'; }

function draw(){
  const site=COV.sites[Number($('site').value)];
  const hi=Number($('hour').value), mode=$('mode').value;
  $('hourval').textContent=String(COV.hours[hi]).padStart(2,'0')+'Z';

  // field into a small offscreen canvas, then scale up smoothly
  const gw=LON.length, gh=LAT.length;
  const off=document.createElement('canvas'); off.width=gw; off.height=gh;
  const octx=off.getContext('2d'); const img=octx.createImageData(gw,gh);
  const bandG=site.band[hi], margG=site.margin[hi], mufG=site.muf[hi];
  const gainDb=Number($('station').value);

  for(let r=0;r<gh;r++) for(let c=0;c<gw;c++){
    const o=((gh-1-r)*gw+c)*4;   // lat ascending in data, y descending on screen
    const b=bandG[r][c], m0=margG[r][c], mf=mufG[r][c];
    const m = m0===null ? null : m0+gainDb;
    let rgb=null, a=0;
    if(mode==='band'){
      // Colour = which band is best. Opacity = how usable it actually is, so a
      // marginal path fades rather than being cut off at an arbitrary threshold
      // (a hard cutoff renders absence as a solid blob that reads like data).
      if(b!==null && m!==null){ rgb=rampColor(b/(NB-1)); a=alphaFor(m); } }
    else if(mode==='margin'){ if(m!==null){ rgb=hex2rgb(statusFill(marginToken(m))); a=alphaFor(m,true); } }
    else { if(mf!==null){ rgb=rampColor((mf-3)/27); a=225; } }
    if(rgb){ img.data[o]=rgb[0]; img.data[o+1]=rgb[1]; img.data[o+2]=rgb[2]; img.data[o+3]=a; }
  }
  octx.putImageData(img,0,0);

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle=cssv('--hf-surface-sunken'); ctx.fillRect(0,0,W,H);
  ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(off,0,0,gw,gh, px(LON[0]), 0, W, H);

  // daylight sits above the data field but below the coastlines, so it reads as
  // a lighting condition rather than as another data layer
  if($('daylight').value === '1') drawDaylight(COV.hours[hi]);

  // coastlines on top, quiet
  ctx.strokeStyle=cssv('--hf-text-muted'); ctx.lineWidth=1; ctx.globalAlpha=.55;
  ctx.beginPath();
  for(const f of COAST.features){
    const g=f.geometry; const lines = g.type==='LineString' ? [g.coordinates] : g.coordinates;
    for(const line of lines){ let started=false, prevX=null;
      for(const [lo,la] of line){ const x=px(lo), y=py(la);
        if(prevX!==null && Math.abs(x-prevX)>W*0.5){ started=false; }   // antimeridian
        if(!started){ ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
        prevX=x; } }
  }
  ctx.stroke(); ctx.globalAlpha=1;

  // graticule
  ctx.strokeStyle=cssv('--hf-border-subtle'); ctx.globalAlpha=.5; ctx.beginPath();
  for(let la=-60;la<=60;la+=30){ ctx.moveTo(0,py(la)); ctx.lineTo(W,py(la)); }
  for(let lo=-120;lo<=120;lo+=60){ ctx.moveTo(px(lo),0); ctx.lineTo(px(lo),H); }
  ctx.stroke(); ctx.globalAlpha=1;

  // transmitter
  const sx=px(site.lon), sy=py(site.lat);
  ctx.strokeStyle=cssv('--hf-accent-interactive'); ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.arc(sx,sy,9,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sx-15,sy); ctx.lineTo(sx+15,sy);
  ctx.moveTo(sx,sy-15); ctx.lineTo(sx,sy+15); ctx.stroke();

  drawLegend(mode);
  $('explain').textContent = mode==='band'
    ? 'Colour is the best band at that point \\u2014 low frequencies at one end of the ramp, high at the other. Opacity carries how much signal margin that band has, so weak paths fade out instead of being cut off at an arbitrary line.'
    : mode==='margin'
    ? 'Colour is how much SNR the best band has to spare against the 24 dB requirement.'
    : 'Colour is the maximum usable frequency over the path to that point.';
}

function drawLegend(mode){
  const lg=$('lg'); lg.replaceChildren();
  if(mode==='margin'){
    for(const [k,t] of [['good','meets the requirement'],['fair','within 10 dB'],
                        ['poor','10\u201325 dB short'],['closed','well short / no path']]){
      const c=document.createElement('span'); c.className='chip';
      const s=document.createElement('span'); s.className='sw'; s.style.background=statusFill(k);
      c.append(s,document.createTextNode(t)); lg.append(c); }
    return;
  }
  const wrap=document.createElement('span'); wrap.className='ramp';
  const n=mode==='band'?NB:8;
  for(let i=0;i<n;i++){ const t=i/(n-1); const [r,g,b]=rampColor(t);
    const e=document.createElement('i'); e.style.background=`rgb(${r},${g},${b})`; wrap.append(e); }
  const a=document.createElement('span'), z=document.createElement('span');
  a.textContent = mode==='band' ? COV.bands[0]+' (3.5 MHz)' : '3 MHz';
  z.textContent = mode==='band' ? COV.bands[NB-1]+' (28 MHz)' : '30 MHz';
  lg.append(a,wrap,z);
  if(mode==='band'){
    const n=document.createElement('span');
    n.textContent='\u2014 colour shows the band; fainter means less signal margin, bare map means no path';
    lg.append(n);
  }
}

cv.addEventListener('mousemove',(e)=>{
  const r=cv.getBoundingClientRect();
  const lon=((e.clientX-r.left)/r.width)*360-180, lat=90-((e.clientY-r.top)/r.height)*180;
  const ri=Math.round((lat-LAT[0])/6), ci=Math.round((lon-LON[0])/6);
  const site=COV.sites[Number($('site').value)], hi=Number($('hour').value);
  if(ri<0||ri>=LAT.length||ci<0||ci>=LON.length){ $('ro').textContent='Hover the map'; return; }
  const gainDb=Number($('station').value);
  const b=site.band[hi][ri][ci], m0=site.margin[hi][ri][ci], mf=site.muf[hi][ri][ci];
  const m = m0===null ? null : m0+gainDb;
  $('ro').textContent =
    `${Math.abs(LAT[ri])}\\u00b0${LAT[ri]<0?'S':'N'}  ${Math.abs(LON[ci])}\\u00b0${LON[ci]<0?'W':'E'}\\n`
    + (b===null||m===null ? 'no path predicted'
       : `best ${COV.bands[b]} (${COV.freqs[b].toFixed(1)} MHz)  margin ${m>0?'+':''}${m} dB`)
    + (mf!==null?`\\nMUF ${mf.toFixed(1)} MHz`:'');
});
cv.addEventListener('mouseleave',()=>{ $('ro').textContent='Hover the map'; });

for(const id of ['site','mode','hour','station','daylight']) $(id).addEventListener('input',draw);
$('theme').addEventListener('change',(e)=>{ $('app').setAttribute('data-app-theme',e.target.value); draw(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',draw);
$('ro').style.whiteSpace='pre';
draw();
</script>
"""
p=pathlib.Path('/home/user/HFKit/apps/web/reach.html'); p.write_text(html)
print('reach.html', round(len(html)/1024), 'KB')
