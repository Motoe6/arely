export function renderSwarmPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ARELEY Swarm Visualizer</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    background: #0a0a0f; color: #e0e0e0; padding: 24px;
  }
  h1 { font-size: 18px; color: #888; margin-bottom: 20px; letter-spacing: 1px; }
  .status { color: #666; font-size: 12px; margin-bottom: 16px; }
  .status .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .status .dot.online { background: #22c55e; }
  .status .dot.offline { background: #ef4444; }
  .role-card {
    background: #14141f; border: 1px solid #1e1e2e; border-radius: 8px;
    padding: 16px; margin-bottom: 12px; transition: border-color 0.3s;
  }
  .role-card.active { border-color: #22c55e33; }
  .role-header {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
  }
  .role-name { font-size: 14px; font-weight: 600; color: #ccc; text-transform: uppercase; letter-spacing: 0.5px; }
  .role-model { font-size: 13px; color: #60a5fa; }
  .role-provider { font-size: 11px; color: #666; }
  .role-score { font-size: 20px; font-weight: 700; }
  .role-score.high { color: #22c55e; }
  .role-score.medium { color: #eab308; }
  .role-score.low { color: #ef4444; }
  .role-details { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #1e1e2e; }
  .detail-item { font-size: 11px; color: #666; }
  .detail-item strong { color: #999; display: block; margin-bottom: 2px; }
  .detail-val { color: #bbb; font-size: 12px; }
  .weights-bar { display: flex; gap: 2px; margin-top: 8px; height: 6px; border-radius: 3px; overflow: hidden; }
  .weights-bar .seg { height: 100%; }
  .weights-bar .seg.historical { background: #3b82f6; }
  .weights-bar .seg.utility { background: #22c55e; }
  .weights-bar .seg.availability { background: #a855f7; }
  .weights-bar .seg.cost { background: #eab308; }
  .weights-bar .seg.latency { background: #f97316; }
  .legend { display: flex; gap: 16px; margin: 12px 0; flex-wrap: wrap; }
  .legend-item { font-size: 10px; color: #666; display: flex; align-items: center; gap: 4px; }
  .legend-item .swatch { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .reason { font-size: 11px; color: #555; font-style: italic; margin-top: 4px; }
  .learning-banner {
    background: #0d1b0e; border: 1px solid #1a3a1e; border-radius: 6px;
    padding: 10px 14px; margin-bottom: 16px; font-size: 11px; color: #6b9b6b;
  }
  .learning-banner strong { color: #22c55e; }
  #no-data {
    text-align: center; color: #444; padding: 60px 20px; font-size: 14px;
  }
</style>
</head>
<body>
  <h1>ARELEY Swarm Visualizer</h1>
  <div class="status" id="status"><span class="dot offline"></span> Waiting for swarm events...</div>
  <div class="legend">
    <span class="legend-item"><span class="swatch" style="background:#3b82f6"></span> historical</span>
    <span class="legend-item"><span class="swatch" style="background:#22c55e"></span> utility</span>
    <span class="legend-item"><span class="swatch" style="background:#a855f7"></span> availability</span>
    <span class="legend-item"><span class="swatch" style="background:#eab308"></span> cost</span>
    <span class="legend-item"><span class="swatch" style="background:#f97316"></span> latency</span>
  </div>
  <div id="learning-banner" class="learning-banner" style="display:none"></div>
  <div id="swarm-container"></div>
  <div id="no-data">Waiting for swarm execution events via SSE...<br><br>Start a swarm session (e.g. POST /api/sessions with mode: "swarm") to see role assignments.</div>
  <script>
    const container = document.getElementById('swarm-container');
    const noData = document.getElementById('no-data');
    const statusEl = document.getElementById('status');
    const learningBanner = document.getElementById('learning-banner');
    let roles = {};

    function scoreClass(s) {
      if (s >= 0.8) return 'high';
      if (s >= 0.5) return 'medium';
      return 'low';
    }

    function render() {
      const entries = Object.entries(roles);
      if (entries.length === 0) { noData.style.display = 'block'; return; }
      noData.style.display = 'none';

      const sorted = entries.sort(([,a], [,b]) => b.score - a.score);
      container.innerHTML = sorted.map(([role, r]) => {
        const totalW = r.w.historical + r.w.utility + r.w.availability + r.w.cost + r.w.latency;
        const pct = (v) => totalW > 0 ? (v / totalW * 100).toFixed(0) : 0;
        return \`
          <div class="role-card active">
            <div class="role-header">
              <div>
                <div class="role-name">\${role}</div>
                <div class="role-model">\${r.model}</div>
                <div class="role-provider">\${r.provider}</div>
              </div>
              <div class="role-score \${scoreClass(r.score)}">\${(r.score * 100).toFixed(0)}</div>
            </div>
            <div class="weights-bar">
              <div class="seg historical" style="width:\${pct(r.w.historical)}%"></div>
              <div class="seg utility" style="width:\${pct(r.w.utility)}%"></div>
              <div class="seg availability" style="width:\${pct(r.w.availability)}%"></div>
              <div class="seg cost" style="width:\${pct(r.w.cost)}%"></div>
              <div class="seg latency" style="width:\${pct(r.w.latency)}%"></div>
            </div>
            <div class="role-details">
              <div class="detail-item"><strong>Confidence</strong><span class="detail-val">\${(r.confidence * 100).toFixed(0)}%</span></div>
              <div class="detail-item"><strong>Score</strong><span class="detail-val">\${r.score.toFixed(3)}</span></div>
            </div>
            <div class="reason">\${r.reason ? '↳ ' + r.reason.replace(/_/g, ' ') : ''}</div>
          </div>
        \`;
      }).join('');
    }

    function showLearning(category, w) {
      learningBanner.style.display = 'block';
      const keys = [
        { k: 'historicalScore', l: 'historical', c: '#3b82f6' },
        { k: 'utility', l: 'utility', c: '#22c55e' },
        { k: 'availability', l: 'availability', c: '#a855f7' },
        { k: 'costEfficiency', l: 'cost', c: '#eab308' },
        { k: 'latencyScore', l: 'latency', c: '#f97316' },
      ];
      const bars = keys.map(k => {
        const pct = (w[k.k] * 100).toFixed(0);
        return \`<span style="display:inline-block;margin-right:12px"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:\${k.c};margin-right:3px"></span>\${k.l} <strong>\${pct}%</strong></span>\`;
      }).join('');
      learningBanner.innerHTML = \`<strong>Learned weights</strong> (\${category}) &mdash; \${bars}\`;
    }

    const evtSource = new EventSource('/api/sse');

    evtSource.addEventListener('swarm_role_selected', (e) => {
      try {
        const data = JSON.parse(e.data);
        statusEl.innerHTML = '<span class="dot online"></span> Live &mdash; Last: ' + data.role + ' (' + data.provider + ':' + data.model + ')';
        roles[data.role] = {
          provider: data.provider,
          model: data.model,
          score: data.score,
          confidence: data.confidence,
          reason: data.reason || '',
          w: data.weights || { historical: 0.5, utility: 0.2, availability: 0.15, cost: 0.1, latency: 0.05 },
        };
        render();
      } catch(_) {}
    });

    evtSource.addEventListener('swarm_learning_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        showLearning(data.category, data.weights);
      } catch(_) {}
    });

    evtSource.addEventListener('session_thinking', () => {
      statusEl.innerHTML = '<span class="dot online"></span> Swarm thinking...';
    });

    evtSource.addEventListener('assistant_message_completed', () => {
      statusEl.innerHTML = '<span class="dot online"></span> Swarm completed';
    });

    evtSource.addEventListener('agent_loop_failed', (e) => {
      try {
        const data = JSON.parse(e.data);
        statusEl.innerHTML = '<span class="dot offline"></span> Failed: ' + (data.error || 'unknown');
      } catch(_) {}
    });

    evtSource.onerror = () => {
      statusEl.innerHTML = '<span class="dot offline"></span> SSE disconnected &mdash; reconnecting...';
    };
  </script>
</body>
</html>`;
}
