export function renderDashboardPage(options?: { title?: string; version?: string }): string {
  const pageTitle = options?.title ?? "Arely Agent — Policy Dashboard";
  const version = options?.version ?? "0.1.0";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(pageTitle)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,monospace;background:#0d1117;color:#c9d1d9;padding:20px;max-width:1200px;margin:0 auto}
header{margin-bottom:24px}
header h1{font-size:20px;color:#f0f6fc;margin-bottom:12px}
header .version{color:#8b949e;font-size:12px;margin-left:8px}
nav{display:flex;gap:4px;border-bottom:1px solid #30363d;padding-bottom:0}
nav button{background:0 0;border:1px solid transparent;border-bottom:none;color:#8b949e;padding:8px 16px;cursor:pointer;font-size:13px;border-radius:6px 6px 0 0}
nav button:hover{color:#c9d1d9;background:#161b22}
nav button.active{color:#f0f6fc;background:#161b22;border-color:#30363d;font-weight:600}
.tab-content{display:none;padding:20px 0}
.tab-content.active{display:block}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.card .value{font-size:28px;font-weight:600;color:#f0f6fc}
.card .value.green{color:#3fb950}
.card .value.red{color:#f85149}
.card .sub{font-size:12px;color:#8b949e;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;border-bottom:2px solid #30363d;color:#8b949e;text-transform:uppercase;font-size:11px;letter-spacing:.5px}
td{padding:8px 12px;border-bottom:1px solid #21262d}
tr:hover td{background:#161b22}
.controls{display:flex;gap:8px;margin-bottom:16px;align-items:center}
.controls select{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 12px;border-radius:6px;font-size:13px}
.controls button{background:#238636;border:none;color:#fff;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600}
.controls button:hover{background:#2ea043}
.controls .status{font-size:12px;color:#8b949e;margin-left:8px}
details{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:8px;padding:8px 12px}
details summary{cursor:pointer;font-weight:600;color:#f0f6fc;padding:4px 0}
details[open]{padding-bottom:12px}
details pre{background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:8px;margin-top:8px;font-size:12px;overflow-x:auto;color:#c9d1d9;white-space:pre-wrap;word-break:break-all}
.rec-card{border:1px solid #30363d;border-radius:6px;padding:12px;margin-bottom:8px}
.rec-card .rec-type{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase;margin-bottom:6px}
.rec-type.dead_rule{background:#f851491a;color:#f85149;border:1px solid #f851494d}
.rec-type.underperforming{background:#d299221a;color:#d29922;border:1px solid #d299224d}
.rec-type.threshold_tuning{background:#58a6ff1a;color:#58a6ff;border:1px solid #58a6ff4d}
.rec-type.conflict{background:#bc8cff1a;color:#bc8cff;border:1px solid #bc8cff4d}
.rec-card .field{font-size:12px;color:#8b949e;margin-top:4px}
.rec-card .field span{color:#c9d1d9}
.tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:600}
.tag.critical{background:#f851491a;color:#f85149;border:1px solid #f851494d}
.tag.high{background:#d299221a;color:#d29922;border:1px solid #d299224d}
.tag.medium{background:#58a6ff1a;color:#58a6ff;border:1px solid #58a6ff4d}
.tag.low{background:#8b949e1a;color:#8b949e;border:1px solid #8b949e4d}
.metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:16px}
.metric-box{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px;text-align:center}
.metric-box .num{font-size:24px;font-weight:600;color:#f0f6fc}
.metric-box .label{font-size:11px;color:#8b949e;text-transform:uppercase;margin-top:4px}
.pipeline-flow{display:flex;flex-direction:column;align-items:center;gap:4px}
.pipeline-flow .arrow{color:#30363d;font-size:20px}
.error{color:#f85149;padding:12px;background:#f851491a;border:1px solid #f851494d;border-radius:6px;font-size:13px}
.loading{color:#8b949e;font-size:13px;padding:12px}
.empty{color:#8b949e;font-size:13px;padding:8px 0}
</style>
</head>
<body>
<header>
<h1>${escapeHtml(pageTitle)}<span class="version">v${escapeHtml(version)}</span></h1>
<nav>
<button data-tab="overview" class="active" onclick="switchTab('overview')">Overview</button>
<button data-tab="packs" onclick="switchTab('packs')">Packs</button>
<button data-tab="recs" onclick="switchTab('recs')">Recommendations</button>
<button data-tab="pipeline" onclick="switchTab('pipeline')">Pipeline Explorer</button>
</nav>
</header>
<main>
<section id="tab-overview" class="tab-content active">
<div class="cards" id="overview-cards">
<div class="card"><h3>Uptime</h3><div class="value" id="ov-uptime">--</div></div>
<div class="card"><h3>Traces</h3><div class="value" id="ov-traces">--</div></div>
<div class="card"><h3>Packs</h3><div class="value" id="ov-packs">--</div></div>
<div class="card"><h3>Health</h3><div class="value green" id="ov-health">OK</div></div>
</div>
<div class="metrics-grid" id="overview-metrics">
<div class="metric-box"><div class="num" id="ov-m-packs">--</div><div class="label">Packs</div></div>
<div class="metric-box"><div class="num" id="ov-m-traces">--</div><div class="label">Traces</div></div>
<div class="metric-box"><div class="num" id="ov-m-recs">--</div><div class="label">Recommendations</div></div>
</div>
</section>
<section id="tab-packs" class="tab-content">
<div class="loading" id="packs-loading">Loading packs...</div>
<div id="packs-content" style="display:none">
<table><thead><tr><th>Name</th><th>Rules</th><th>PolicyHash</th><th>Modified</th></tr></thead>
<tbody id="packs-tbody"></tbody></table>
</div>
</section>
<section id="tab-recs" class="tab-content">
<div class="controls">
<select id="recs-pack-select"><option value="">-- Select pack --</option></select>
<button onclick="analyzePack()">Analyze</button>
<span class="status" id="recs-status"></span>
</div>
<div id="recs-results"></div>
</section>
<section id="tab-pipeline" class="tab-content">
<div class="controls">
<select id="pipeline-pack-select"><option value="">-- Select pack --</option></select>
<button onclick="runPipeline()">Run Pipeline</button>
<span class="status" id="pipeline-status"></span>
</div>
<div id="pipeline-results"></div>
</section>
</main>
<script>
function switchTab(t){document.querySelectorAll('.tab-content').forEach(function(e){e.classList.remove('active')});document.querySelectorAll('nav button').forEach(function(b){b.classList.remove('active')});document.getElementById('tab-'+t).classList.add('active');document.querySelector('button[data-tab="'+t+'"]').classList.add('active')}
function _api(u,m,b){var o={method:m,headers:{}};if(b){o.headers['Content-Type']='application/json';o.body=JSON.stringify(b)}return fetch(u,o).then(function(r){if(!r.ok){return r.json().then(function(e){throw new Error(e.error||'HTTP '+r.status)})}return r.json()})}
function _esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
function _fmtTime(s){if(!s||s==='--')return'--';var h=Math.floor(s/3600),m=Math.floor((s%3600)/60);if(h>0)return h+'h '+m+'m';if(m>0)return m+'m '+Math.floor(s%60)+'s';return Math.floor(s)+'s'}
function _fmtDate(s){if(!s)return'--';try{return new Date(s).toLocaleDateString()}catch(e){return s||'--'}}
function _sevTag(s){var c={critical:'tag critical',high:'tag high',medium:'tag medium',low:'tag low'};return'<span class="'+(c[s]||'tag low')+'">'+_esc(s||'unknown')+'</span>'}

function loadOverview(){_api('/control/status','GET').then(function(d){document.getElementById('ov-uptime').textContent=_fmtTime(d.uptime);document.getElementById('ov-traces').textContent=String(d.traces!=null?d.traces:'--');document.getElementById('ov-packs').textContent=String(d.packs!=null?d.packs:'--');var h=d.ok?'OK':'ERROR';document.getElementById('ov-health').textContent=h;document.getElementById('ov-health').className='value '+(d.ok?'green':'red');document.getElementById('ov-m-packs').textContent=String(d.packs!=null?d.packs:'--');document.getElementById('ov-m-traces').textContent=String(d.traces!=null?d.traces:'--')}).catch(function(e){document.getElementById('ov-uptime').textContent='ERR';document.getElementById('ov-health').textContent='DOWN';document.getElementById('ov-health').className='value red'});_api('/control/recommendations','GET').then(function(d){document.getElementById('ov-m-recs').textContent=String(d.count!=null?d.count:0)}).catch(function(e){document.getElementById('ov-m-recs').textContent='ERR'})}
loadOverview();

function loadPacks(){_api('/control/packs','GET').then(function(d){var tbody=document.getElementById('packs-tbody');tbody.innerHTML='';(d.packs||[]).forEach(function(p){var tr=document.createElement('tr');tr.innerHTML='<td>'+_esc(p.name||'?')+'</td><td>'+(p.rules?p.rules.length:0)+'</td><td style="font-family:monospace;font-size:11px">'+_esc((p.policyHash||'').slice(0,16))+'</td><td>'+_fmtDate(p.updatedAt||p.createdAt)+'</td>';tbody.appendChild(tr)});['recs-pack-select','pipeline-pack-select'].forEach(function(id){var sel=document.getElementById(id),cur=sel.value;sel.innerHTML='<option value="">-- Select pack --</option>';(d.packs||[]).forEach(function(p){var o=document.createElement('option');o.value=p.id;o.textContent=p.name||p.id;sel.appendChild(o)});if(cur)sel.value=cur});document.getElementById('packs-loading').style.display='none';document.getElementById('packs-content').style.display='block'}).catch(function(e){document.getElementById('packs-loading').textContent='Failed to load packs: '+e.message})}
loadPacks();

function analyzePack(){var sel=document.getElementById('recs-pack-select'),id=sel.value;if(!id){document.getElementById('recs-status').textContent='Select a pack first';return}var results=document.getElementById('recs-results');results.innerHTML='<div class="loading">Analyzing...</div>';document.getElementById('recs-status').textContent='';_api('/control/analyze','POST',{packId:id}).then(function(d){results.innerHTML='';var s=d.summary||{};results.insertAdjacentHTML('beforeend','<div class="metrics-grid">'+
'<div class="metric-box"><div class="num">'+(s.total!=null?s.total:0)+'</div><div class="label">Total</div></div>'+
'<div class="metric-box"><div class="num" style="color:#f85149">'+(s.critical!=null?s.critical:0)+'</div><div class="label">Critical</div></div>'+
'<div class="metric-box"><div class="num" style="color:#d29922">'+(s.high!=null?s.high:0)+'</div><div class="label">High</div></div>'+
'<div class="metric-box"><div class="num" style="color:#58a6ff">'+(s.medium!=null?s.medium:0)+'</div><div class="label">Medium</div></div>'+
'<div class="metric-box"><div class="num" style="color:#8b949e">'+(s.low!=null?s.low:0)+'</div><div class="label">Low</div></div>'+
'<div class="metric-box"><div class="num">'+((s.averageImpactScore!=null?s.averageImpactScore:0).toFixed(2))+'</div><div class="label">Avg Impact</div></div>'+
'<div class="metric-box"><div class="num">'+((s.maxImpactScore!=null?s.maxImpactScore:0).toFixed(2))+'</div><div class="label">Max Impact</div></div>'+
'</div>');if(!d.recommendations||d.recommendations.length===0){results.insertAdjacentHTML('beforeend','<div class="empty" style="margin-top:12px">No recommendations for this pack.</div>');return}
for(var i=0;i<d.recommendations.length;i++){var r=d.recommendations[i],vr=d.validatedRecommendations&&d.validatedRecommendations[i];results.insertAdjacentHTML('beforeend','<div class="rec-card">'+
'<div class="rec-type '+_esc(r.type)+'">'+_esc(r.type).replace(/_/g,' ')+'</div>'+
'<div class="field">Rule: <span>'+_esc(r.ruleId)+'</span></div>'+
'<div class="field">Severity: '+_sevTag(r.severity)+'</div>'+
(r.confidence!=null?'<div class="field">Confidence: <span>'+(r.confidence*100).toFixed(0)+'%</span></div>':'')+
(vr?'<div class="field">Impact Score: <span>'+(vr.impactScore!=null?vr.impactScore.toFixed(2):'--')+'</span></div>':'')+
(vr&&vr.tracesRequested!=null?'<div class="field">Traces: <span>'+vr.tracesSucceeded+'/'+vr.tracesRequested+' succeeded</span></div>':'')+
'<details style="margin-top:8px"><summary>Details</summary><pre>'+_esc(JSON.stringify(r,null,2))+'</pre></details>'+
'</div>')}document.getElementById('recs-status').textContent='Done ('+d.recommendations.length+' recs)'}).catch(function(e){results.innerHTML='<div class="error">'+_esc(e.message)+'</div>'})}

function runPipeline(){var sel=document.getElementById('pipeline-pack-select'),id=sel.value;if(!id){document.getElementById('pipeline-status').textContent='Select a pack first';return}var results=document.getElementById('pipeline-results');results.innerHTML='<div class="loading">Running pipeline...</div>';document.getElementById('pipeline-status').textContent='';_api('/control/pipeline','POST',{packId:id}).then(function(d){results.innerHTML='<div class="pipeline-flow">';var sim=d.simulation||{};results.insertAdjacentHTML('beforeend','<details open><summary>Simulation</summary><pre>Traces: '+sim.tracesSucceeded+'/'+sim.tracesRequested+' succeeded · Match rate: '+((sim.overallMatchRate||0)*100).toFixed(1)+'% · Removed: '+sim.totalRemoved+'</pre></details>');
results.insertAdjacentHTML('beforeend','<div class="arrow">&#9660;</div>');
if(d.recommendations&&d.recommendations.length>0){var rh='<details><summary>Recommendations ('+d.recommendations.length+')</summary>';d.recommendations.forEach(function(r){rh+='<div class="rec-card" style="margin-top:8px"><div class="rec-type '+_esc(r.type)+'">'+_esc(r.type).replace(/_/g,' ')+'</div><div class="field">Rule: <span>'+_esc(r.ruleId)+'</span></div><div class="field">Severity: '+_sevTag(r.severity)+'</div></div>'});rh+='</details>';results.insertAdjacentHTML('beforeend',rh)}else{results.insertAdjacentHTML('beforeend','<details><summary>Recommendations</summary><div class="empty">None</div></details>')}
results.insertAdjacentHTML('beforeend','<div class="arrow">&#9660;</div>');
if(d.impactReports&&d.impactReports.length>0){var ih='<details><summary>Impact Reports ('+d.impactReports.length+')</summary>';d.impactReports.forEach(function(ir,i){ih+='<details style="margin-top:8px"><summary>Report #'+(i+1)+' — Score: '+(ir.impactScore!=null?ir.impactScore.toFixed(2):'--')+'</summary><pre>'+_esc(JSON.stringify(ir,null,2))+'</pre></details>'});ih+='</details>';results.insertAdjacentHTML('beforeend',ih)}else{results.insertAdjacentHTML('beforeend','<details><summary>Impact Reports</summary><div class="empty">None</div></details>')}
results.insertAdjacentHTML('beforeend','</div>');
if(d.meta){var m=d.meta;results.insertAdjacentHTML('beforeend','<div class="metrics-grid" style="margin-top:12px"><div class="metric-box"><div class="num">'+m.tracesRequested+'</div><div class="label">Requested</div></div><div class="metric-box"><div class="num">'+m.tracesSucceeded+'</div><div class="label">Succeeded</div></div><div class="metric-box"><div class="num">'+(m.tracesFailed||0)+'</div><div class="label">Failed</div></div><div class="metric-box"><div class="num">'+(m.durationMs||'--')+'ms</div><div class="label">Duration</div></div></div>')}
document.getElementById('pipeline-status').textContent='Done ('+(d.meta?d.meta.durationMs:'--')+'ms)'}).catch(function(e){results.innerHTML='<div class="error">'+_esc(e.message)+'</div>'})}
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
