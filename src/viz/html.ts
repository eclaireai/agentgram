/**
 * agentgram Interactive Visualizer
 *
 * Generates a self-contained HTML file with an interactive DAG visualization.
 * Uses D3.js (loaded from CDN) for force-directed graph layout.
 *
 * Usage:
 *   agentgram viz <session-id>           # opens browser
 *   agentgram viz <session-id> -o out.html  # saves to file
 */

import type { ProvenanceGraph, Session, Recipe } from '../core/types.js';

export interface VizData {
  session: Session;
  provenance: ProvenanceGraph;
  recipe: Recipe;
}

export function generateVizHtml(data: VizData): string {
  const { session, provenance, recipe } = data;

  const nodesJson = JSON.stringify(
    provenance.nodes.map((n) => ({
      id: n.operationId,
      type: n.type,
      target: n.target,
      timestamp: n.timestamp,
      label: `${n.type}: ${n.target.split('/').pop()}`,
    })),
  );

  const edgesJson = JSON.stringify(
    provenance.edges.map((e) => ({
      source: e.from,
      target: e.to,
      relation: e.relation,
    })),
  );

  const sessionJson = JSON.stringify({
    id: session.id,
    name: session.name,
    state: session.state,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    operationCount: session.operations.length,
    branch: session.branch,
  });

  const recipeJson = JSON.stringify(recipe);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>agentgram — ${escapeHtml(session.name)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    overflow: hidden;
  }
  #header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 48px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    display: flex;
    align-items: center;
    padding: 0 16px;
    z-index: 100;
    gap: 16px;
  }
  #header .logo {
    font-weight: 700;
    font-size: 16px;
    color: #58a6ff;
  }
  #header .session-name {
    color: #8b949e;
    font-size: 14px;
  }
  #header .stats {
    margin-left: auto;
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: #8b949e;
  }
  #header .stats span {
    background: #21262d;
    padding: 4px 8px;
    border-radius: 6px;
  }
  #header .stats .count {
    color: #58a6ff;
    font-weight: 600;
  }
  #graph-container {
    position: fixed;
    top: 48px;
    left: 0;
    right: 320px;
    bottom: 0;
  }
  #sidebar {
    position: fixed;
    top: 48px;
    right: 0;
    width: 320px;
    bottom: 0;
    background: #161b22;
    border-left: 1px solid #30363d;
    overflow-y: auto;
    padding: 16px;
  }
  #sidebar h3 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #8b949e;
    margin-bottom: 8px;
  }
  #sidebar .detail-block {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 16px;
    font-size: 13px;
    line-height: 1.6;
  }
  #sidebar .detail-block .label {
    color: #8b949e;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  #sidebar .detail-block .value {
    color: #c9d1d9;
    word-break: break-all;
  }
  #sidebar .detail-block .value.type-read { color: #79c0ff; }
  #sidebar .detail-block .value.type-write { color: #d29922; }
  #sidebar .detail-block .value.type-create { color: #3fb950; }
  #sidebar .detail-block .value.type-delete { color: #f85149; }
  #sidebar .detail-block .value.type-exec { color: #bc8cff; }
  .recipe-step {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 4px;
    font-size: 12px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .recipe-step .step-num {
    color: #484f58;
    font-weight: 600;
    min-width: 20px;
  }
  .recipe-step .step-action {
    font-family: monospace;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    background: #21262d;
  }
  .node circle {
    stroke-width: 2px;
    cursor: pointer;
    transition: r 0.15s;
  }
  .node circle:hover { r: 12; }
  .node text {
    font-size: 10px;
    fill: #8b949e;
    pointer-events: none;
  }
  .node.selected circle {
    stroke: #f0f6fc !important;
    stroke-width: 3px;
  }
  .link {
    fill: none;
    stroke-opacity: 0.4;
  }
  .link.informed { stroke: #58a6ff; }
  .link.depends_on { stroke: #d29922; stroke-dasharray: 5 3; }
  .link.triggered { stroke: #bc8cff; stroke-dasharray: 2 2; }
  .link.modified { stroke: #3fb950; stroke-width: 2; }
  .link-label {
    font-size: 9px;
    fill: #484f58;
  }
  .tooltip {
    position: absolute;
    background: #1c2128;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    pointer-events: none;
    z-index: 200;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    max-width: 300px;
  }
  #legend {
    display: flex;
    gap: 12px;
    padding: 8px 0;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  #legend .item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #8b949e;
  }
  #legend .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
</style>
</head>
<body>
<div id="header">
  <span class="logo">agentgram</span>
  <span class="session-name" id="session-name"></span>
  <div class="stats">
    <span><span class="count" id="stat-ops">0</span> ops</span>
    <span><span class="count" id="stat-nodes">0</span> nodes</span>
    <span><span class="count" id="stat-edges">0</span> edges</span>
    <span><span class="count" id="stat-steps">0</span> recipe steps</span>
  </div>
</div>

<div id="graph-container"></div>

<div id="sidebar">
  <h3>Legend</h3>
  <div id="legend">
    <div class="item"><div class="dot" style="background:#79c0ff"></div> read</div>
    <div class="item"><div class="dot" style="background:#d29922"></div> write</div>
    <div class="item"><div class="dot" style="background:#3fb950"></div> create</div>
    <div class="item"><div class="dot" style="background:#f85149"></div> delete</div>
    <div class="item"><div class="dot" style="background:#bc8cff"></div> exec</div>
  </div>

  <h3>Selected Operation</h3>
  <div class="detail-block" id="detail-panel">
    <div style="color:#484f58">Click a node to inspect</div>
  </div>

  <h3>Distilled Recipe</h3>
  <div id="recipe-panel"></div>
</div>

<div class="tooltip" id="tooltip" style="display:none"></div>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const nodes = ${nodesJson};
const edges = ${edgesJson};
const session = ${sessionJson};
const recipe = ${recipeJson};

// Stats
document.getElementById('session-name').textContent = session.name;
document.getElementById('stat-ops').textContent = session.operationCount;
document.getElementById('stat-nodes').textContent = nodes.length;
document.getElementById('stat-edges').textContent = edges.length;
document.getElementById('stat-steps').textContent = recipe.steps.length;

// Recipe panel
const recipePanel = document.getElementById('recipe-panel');
recipe.steps.forEach((step, i) => {
  const el = document.createElement('div');
  el.className = 'recipe-step';
  el.innerHTML = '<span class="step-num">' + (i+1) + '</span>' +
    '<span class="step-action">' + step.action + '</span>' +
    '<span>' + step.target.split('/').pop() + '</span>';
  recipePanel.appendChild(el);
});

// Colors
const typeColor = { read: '#79c0ff', write: '#d29922', create: '#3fb950', delete: '#f85149', exec: '#bc8cff' };

// Graph
const container = document.getElementById('graph-container');
const width = container.clientWidth;
const height = container.clientHeight;

const svg = d3.select('#graph-container')
  .append('svg')
  .attr('width', width)
  .attr('height', height);

// Zoom
const g = svg.append('g');
svg.call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => g.attr('transform', e.transform)));

// Arrow markers
const defs = svg.append('defs');
['informed','depends_on','triggered','modified'].forEach(rel => {
  defs.append('marker')
    .attr('id', 'arrow-'+rel)
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 20)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', rel === 'informed' ? '#58a6ff' : rel === 'depends_on' ? '#d29922' : rel === 'triggered' ? '#bc8cff' : '#3fb950');
});

// Force simulation
const simulation = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(edges).id(d => d.id).distance(120))
  .force('charge', d3.forceManyBody().strength(-300))
  .force('center', d3.forceCenter(width / 2, height / 2))
  .force('x', d3.forceX(width / 2).strength(0.05))
  .force('y', d3.forceY(height / 2).strength(0.05));

// Links
const link = g.selectAll('.link')
  .data(edges)
  .join('line')
  .attr('class', d => 'link ' + d.relation)
  .attr('marker-end', d => 'url(#arrow-' + d.relation + ')');

// Nodes
const node = g.selectAll('.node')
  .data(nodes)
  .join('g')
  .attr('class', 'node')
  .call(d3.drag()
    .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

node.append('circle')
  .attr('r', 8)
  .attr('fill', d => typeColor[d.type] || '#8b949e')
  .attr('stroke', d => typeColor[d.type] || '#8b949e')
  .attr('stroke-opacity', 0.3)
  .attr('fill-opacity', 0.8);

node.append('text')
  .attr('dx', 14)
  .attr('dy', 4)
  .text(d => d.label);

// Tooltip
const tooltip = document.getElementById('tooltip');
node.on('mouseover', (e, d) => {
  tooltip.style.display = 'block';
  tooltip.innerHTML = '<strong>' + d.type + '</strong>: ' + d.target + '<br><span style="color:#8b949e">' + new Date(d.timestamp).toISOString().slice(11,19) + '</span>';
}).on('mousemove', (e) => {
  tooltip.style.left = (e.clientX + 12) + 'px';
  tooltip.style.top = (e.clientY - 10) + 'px';
}).on('mouseout', () => {
  tooltip.style.display = 'none';
});

// Click to select
node.on('click', (e, d) => {
  d3.selectAll('.node').classed('selected', false);
  d3.select(e.currentTarget).classed('selected', true);

  const panel = document.getElementById('detail-panel');
  const op = session;
  panel.innerHTML =
    '<div><span class="label">ID</span><br><span class="value" style="font-family:monospace;font-size:11px">' + d.id + '</span></div><br>' +
    '<div><span class="label">Type</span><br><span class="value type-' + d.type + '">' + d.type + '</span></div><br>' +
    '<div><span class="label">Target</span><br><span class="value">' + d.target + '</span></div><br>' +
    '<div><span class="label">Time</span><br><span class="value">' + new Date(d.timestamp).toISOString() + '</span></div>';

  // Highlight connected edges
  link.attr('stroke-opacity', l => (l.source.id === d.id || l.target.id === d.id) ? 0.9 : 0.15);
});

// Click background to deselect
svg.on('click', (e) => {
  if (e.target === svg.node()) {
    d3.selectAll('.node').classed('selected', false);
    link.attr('stroke-opacity', 0.4);
    document.getElementById('detail-panel').innerHTML = '<div style="color:#484f58">Click a node to inspect</div>';
  }
});

// Tick
simulation.on('tick', () => {
  link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
});
</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Interactive Time-Travel Debugger
// ---------------------------------------------------------------------------

/** Minimal shape of a ReplayTape — full type lives in replay/types.ts which
 *  may not always be present.  We use duck-typing so this file compiles even
 *  without that module.
 */
interface ReplayTapeLike {
  sessionId?: string;
  modelVersion?: string;
  hash?: string;
  /** Arbitrary extra fields are fine */
  [key: string]: unknown;
}

export function generateDebuggerHtml(
  data: VizData & { tape?: ReplayTapeLike | null },
): string {
  const { session, tape } = data;

  // Embed all the data the client-side JS needs --------------------------------
  const sessionJson = JSON.stringify({
    id: session.id,
    name: session.name,
    state: session.state,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt ?? null,
    branch: session.branch,
    cwd: session.cwd,
    operations: session.operations.map((op) => ({
      id: op.id,
      type: op.type,
      timestamp: op.timestamp,
      target: op.target,
      reason: op.reason ?? null,
      causedBy: op.causedBy,
      metadata: op.metadata,
    })),
  });

  const tapeJson = tape ? JSON.stringify(tape) : 'null';
  const opCount = session.operations.length;
  const sessionName = escapeHtml(session.name);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>agentgram time-travel debugger — ${sessionName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
/* ---- Reset & base ---- */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0a0a0a;
  --bg2: #111111;
  --bg3: #1a1a1a;
  --border: #2a2a2a;
  --text: #e5e5e5;
  --text-muted: #666;
  --purple: #7c3aed;
  --purple-light: #a78bfa;
  --cyan: #06b6d4;
  --green: #22c55e;
  --red: #ef4444;
  --yellow: #f59e0b;
  --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-code: 'JetBrains Mono', 'Fira Code', monospace;
}

body {
  font-family: var(--font-ui);
  background: var(--bg);
  color: var(--text);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-size: 13px;
}

/* ---- Header ---- */
header.dbg-header {
  flex: 0 0 auto;
  height: 44px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
  z-index: 10;
}
.dbg-logo { font-weight: 700; font-size: 14px; color: var(--purple-light); }
.dbg-sep { color: var(--border); }
.dbg-title { color: var(--text-muted); font-size: 13px; }
.dbg-badge {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--cyan);
  font-weight: 500;
}
.dbg-header-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }

/* ---- Three-panel layout ---- */
.debugger { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.panels {
  display: grid;
  grid-template-columns: 300px 1fr 220px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ---- Timeline panel ---- */
.timeline-panel {
  background: var(--bg2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.panel-header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  flex: 0 0 auto;
}
.timeline-list {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.timeline-item {
  display: flex;
  align-items: center;
  gap: 0;
  cursor: pointer;
  border-bottom: 1px solid var(--bg3);
  position: relative;
  transition: background 0.1s;
}
.timeline-item:hover { background: var(--bg3); }
.timeline-item.active { background: rgba(124, 58, 237, 0.15); }
.timeline-item.active .tl-line { border-left-color: var(--purple); }
.timeline-gutter {
  width: 20px;
  min-width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 8px 0;
  cursor: pointer;
  flex: 0 0 20px;
}
.bp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid var(--text-muted);
  transition: all 0.1s;
}
.bp-dot.active-bp { background: var(--red); border-color: var(--red); box-shadow: 0 0 4px var(--red); }
.tl-line {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 7px 6px;
  border-left: 2px solid transparent;
  min-width: 0;
}
.tl-icon { font-size: 13px; flex: 0 0 auto; }
.tl-info { flex: 1; min-width: 0; }
.tl-type { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
.tl-target { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-code); }
.tl-ts { font-size: 10px; color: #444; flex: 0 0 auto; }

.type-read .tl-type { color: var(--cyan); }
.type-write .tl-type { color: var(--yellow); }
.type-exec .tl-type { color: var(--purple-light); }
.type-create .tl-type { color: var(--green); }
.type-delete .tl-type { color: var(--red); }

/* ---- File panel ---- */
.file-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}
.tab-bar {
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
  scrollbar-width: none;
  background: var(--bg2);
}
.tab-bar::-webkit-scrollbar { display: none; }
.file-tab {
  padding: 8px 14px;
  font-size: 11px;
  font-family: var(--font-code);
  white-space: nowrap;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  transition: all 0.1s;
  flex: 0 0 auto;
}
.file-tab:hover { color: var(--text); background: var(--bg3); }
.file-tab.active { color: var(--purple-light); border-bottom-color: var(--purple); background: var(--bg); }
.file-content-area {
  flex: 1;
  overflow: auto;
  padding: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.file-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  gap: 8px;
}
.file-placeholder-icon { font-size: 32px; }
pre.code-view {
  margin: 0;
  font-family: var(--font-code);
  font-size: 12px;
  line-height: 1.7;
  background: var(--bg) !important;
  padding: 0;
}
pre.code-view code { background: transparent !important; padding: 0 !important; }
.code-line {
  display: flex;
  align-items: flex-start;
  padding: 0 16px;
  min-height: 1.7em;
}
.code-line:hover { background: rgba(255,255,255,0.03); }
.line-num {
  user-select: none;
  min-width: 36px;
  color: #333;
  font-size: 11px;
  padding-right: 16px;
  text-align: right;
  flex: 0 0 auto;
  line-height: 1.7;
}
.line-text { flex: 1; white-space: pre; }
.line-added { background: rgba(34, 197, 94, 0.12); }
.line-added .line-num { color: var(--green); }
.line-removed { background: rgba(239, 68, 68, 0.1); text-decoration: line-through; color: #666; }
.line-removed .line-num { color: var(--red); }
.diff-banner {
  padding: 6px 16px;
  font-size: 11px;
  background: rgba(124, 58, 237, 0.1);
  border-bottom: 1px solid var(--border);
  color: var(--purple-light);
  flex: 0 0 auto;
}

/* ---- Inspector panel ---- */
.inspector-panel {
  background: var(--bg2);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.inspector-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.insp-section { margin-bottom: 16px; }
.insp-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.insp-val {
  font-size: 12px;
  color: var(--text);
  word-break: break-all;
  line-height: 1.5;
}
.insp-val.mono { font-family: var(--font-code); font-size: 11px; }
.insp-val.purple { color: var(--purple-light); }
.insp-val.cyan { color: var(--cyan); }
.causedby-link {
  display: inline-block;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  margin: 2px;
  font-size: 11px;
  font-family: var(--font-code);
  cursor: pointer;
  color: var(--cyan);
  text-decoration: none;
  transition: background 0.1s;
}
.causedby-link:hover { background: rgba(6, 182, 212, 0.1); }
.fork-btn {
  width: 100%;
  padding: 8px;
  background: rgba(124, 58, 237, 0.2);
  border: 1px solid var(--purple);
  border-radius: 6px;
  color: var(--purple-light);
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  margin-top: 8px;
}
.fork-btn:hover { background: rgba(124, 58, 237, 0.35); }
.insp-divider { border: none; border-top: 1px solid var(--border); margin: 12px 0; }

/* ---- Transport bar ---- */
.transport {
  flex: 0 0 auto;
  height: 52px;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
}
.transport-btn {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text);
  padding: 5px 10px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.1s;
  line-height: 1;
}
.transport-btn:hover { background: rgba(124,58,237,0.2); border-color: var(--purple); }
.transport-btn.play-btn { background: rgba(124,58,237,0.15); border-color: var(--purple); color: var(--purple-light); }
#scrubber-container {
  flex: 1;
  margin: 0 8px;
  position: relative;
  height: 6px;
  background: var(--bg3);
  border-radius: 3px;
  cursor: pointer;
  border: 1px solid var(--border);
}
#scrubber-fill {
  height: 100%;
  background: var(--purple);
  border-radius: 3px;
  transition: width 0.1s;
  pointer-events: none;
}
#scrubber-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  background: white;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
.speed-group { display: flex; gap: 2px; }
.speed-btn {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-muted);
  padding: 3px 7px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.1s;
  font-family: var(--font-ui);
}
.speed-btn.active { background: rgba(6,182,212,0.15); border-color: var(--cyan); color: var(--cyan); }
.export-btn {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  padding: 5px 10px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.1s;
  font-family: var(--font-ui);
}
.export-btn:hover { border-color: var(--cyan); color: var(--cyan); }
.step-counter {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  min-width: 60px;
  text-align: center;
}

/* ---- Fork modal ---- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px;
  max-width: 460px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}
.modal h3 { font-size: 15px; margin-bottom: 12px; color: var(--purple-light); }
.modal pre {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  font-family: var(--font-code);
  font-size: 12px;
  color: var(--cyan);
  margin: 12px 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.modal-close {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 7px 18px;
  font-family: var(--font-ui);
  font-size: 13px;
  cursor: pointer;
  float: right;
}
.modal-close:hover { background: var(--border); }

/* ---- Responsive ---- */
@media (max-width: 800px) {
  .panels {
    grid-template-columns: 1fr;
    grid-template-rows: 240px 1fr 200px;
    overflow-y: auto;
  }
  .timeline-panel, .file-panel, .inspector-panel {
    border: none;
    border-bottom: 1px solid var(--border);
  }
}
</style>
</head>
<body>
<div class="debugger">
  <header class="dbg-header">
    <span class="dbg-logo">agentgram</span>
    <span class="dbg-sep">·</span>
    <span class="dbg-title">time-travel debugger</span>
    <span class="dbg-sep">·</span>
    <span class="dbg-title" id="dbg-session-name">${sessionName}</span>
    <span class="dbg-badge" id="dbg-op-count">${opCount} operations</span>
    <div class="dbg-header-right">
      <span class="dbg-badge" id="dbg-tape-hash" style="display:none"></span>
    </div>
  </header>

  <div class="panels">
    <!-- Timeline -->
    <div class="timeline-panel">
      <div class="panel-header">Timeline</div>
      <div class="timeline-list" id="timeline-list"></div>
    </div>

    <!-- File state -->
    <div class="file-panel">
      <div class="tab-bar" id="tab-bar"></div>
      <div id="diff-banner" class="diff-banner" style="display:none"></div>
      <div class="file-content-area" id="file-content-area">
        <div class="file-placeholder">
          <span class="file-placeholder-icon">📂</span>
          <span>Select a step to inspect file state</span>
        </div>
      </div>
    </div>

    <!-- Inspector -->
    <div class="inspector-panel">
      <div class="panel-header">Inspector</div>
      <div class="inspector-body" id="inspector-body">
        <div style="color:var(--text-muted);font-size:12px">Click a step to inspect.</div>
      </div>
    </div>
  </div>

  <!-- Transport -->
  <div class="transport">
    <button class="transport-btn" id="btn-first" title="Go to start">⏮</button>
    <button class="transport-btn" id="btn-prev" title="Step back">◀</button>
    <button class="transport-btn play-btn" id="btn-play" title="Play/Pause">▶</button>
    <button class="transport-btn" id="btn-next" title="Step forward">▶</button>
    <button class="transport-btn" id="btn-last" title="Go to end">⏭</button>
    <span class="step-counter" id="step-counter">0 / ${opCount}</span>
    <div id="scrubber-container">
      <div id="scrubber-fill" style="width:0%"></div>
      <div id="scrubber-thumb" style="left:0%"></div>
    </div>
    <div class="speed-group">
      <button class="speed-btn" data-speed="0.5">0.5×</button>
      <button class="speed-btn active" data-speed="1">1×</button>
      <button class="speed-btn" data-speed="2">2×</button>
      <button class="speed-btn" data-speed="4">4×</button>
    </div>
    <button class="export-btn" id="btn-export">⬇ Export tape</button>
  </div>
</div>

<!-- Fork modal -->
<div class="modal-overlay" id="fork-modal" style="display:none">
  <div class="modal">
    <h3>Fork point saved</h3>
    <p style="font-size:12px;color:var(--text-muted)">To replay from this step, run:</p>
    <pre id="fork-cmd"></pre>
    <button class="modal-close" id="fork-close">Close</button>
  </div>
</div>

<script>
// ============================================================
// Data
// ============================================================
const SESSION = ${sessionJson};
const TAPE = ${tapeJson};
const ops = SESSION.operations;

// ============================================================
// State
// ============================================================
let currentStep = -1;          // -1 = nothing selected
let breakpoints = new Set();   // Set of op indices
let isPlaying = false;
let playSpeed = 1;
let playTimer = null;
let activeFileTab = null;

// file content at each step: map from step index -> map of filename -> content
// we build this lazily by simulating writes/creates/deletes up to each step
const fileStateCache = {};

// ============================================================
// Op icon/color helpers
// ============================================================
const OP_ICON = { read: '📖', write: '✏️', exec: '⚡', create: '🆕', delete: '🗑️' };
const OP_COLOR = { read: '#06b6d4', write: '#f59e0b', exec: '#a78bfa', create: '#22c55e', delete: '#ef4444' };

function opIcon(type) { return OP_ICON[type] || '•'; }
function shortTarget(t) { return (t || '').split('/').pop() || t; }
function fmtTime(ts) {
  const d = new Date(ts);
  return d.toISOString().slice(11, 19);
}

// ============================================================
// File state simulation
// ============================================================
// Builds the file state (map of path->content) up to and including step idx.
function buildFileState(idx) {
  if (idx < 0) return {};
  if (fileStateCache[idx]) return fileStateCache[idx];

  // Start from step 0 always (cache progressively)
  const start = Object.keys(fileStateCache).reduce((max, k) => {
    const n = parseInt(k, 10);
    return n <= idx && n > max ? n : max;
  }, -1);

  let state = start >= 0 ? Object.assign({}, fileStateCache[start]) : {};
  // deep copy values
  state = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v]));

  for (let i = start + 1; i <= idx; i++) {
    const op = ops[i];
    if (!op) continue;
    if (op.type === 'create' || op.type === 'write') {
      // Extract content from metadata.patch or just record the operation happened
      const content = extractContent(op, state[op.target] || '');
      state[op.target] = content;
    } else if (op.type === 'delete') {
      delete state[op.target];
    }
    fileStateCache[i] = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v]));
  }
  return fileStateCache[idx] || state;
}

function extractContent(op, prevContent) {
  // If metadata has a patch, apply it; otherwise just track the target was touched
  const meta = op.metadata || {};
  if (meta.patch) {
    try { return applyUnifiedPatch(prevContent, meta.patch); } catch(e) {}
  }
  // Fallback: if we have output use it, else keep previous content with a marker
  if (meta.output && op.type === 'write') return meta.output;
  if (op.type === 'create') return '// [file created]';
  return prevContent;
}

// Very minimal unified-diff applicator (handles +/- lines)
function applyUnifiedPatch(original, patch) {
  const origLines = original.split('\\n');
  const patchLines = patch.split('\\n');
  const result = [...origLines];
  let offset = 0;
  let i = 0;
  while (i < patchLines.length) {
    const line = patchLines[i];
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        const origStart = parseInt(m[1], 10) - 1;
        i++;
        let pos = origStart + offset;
        while (i < patchLines.length && !patchLines[i].startsWith('@@')) {
          const pl = patchLines[i];
          if (pl.startsWith('-')) { result.splice(pos, 1); offset--; }
          else if (pl.startsWith('+')) { result.splice(pos, 0, pl.slice(1)); pos++; offset++; }
          else { pos++; }
          i++;
        }
        continue;
      }
    }
    i++;
  }
  return result.join('\\n');
}

// ============================================================
// Collect all unique file paths touched across entire session
// ============================================================
function getAllFiles() {
  const seen = new Set();
  const files = [];
  ops.forEach(op => {
    if ((op.type === 'read' || op.type === 'write' || op.type === 'create' || op.type === 'delete') && op.target) {
      if (!seen.has(op.target)) { seen.add(op.target); files.push(op.target); }
    }
  });
  return files;
}

// ============================================================
// LCS-based line diff
// ============================================================
function computeLineDiff(oldContent, newContent) {
  if (oldContent === newContent) return null;
  const oldLines = (oldContent || '').split('\\n');
  const newLines = (newContent || '').split('\\n');

  // Build LCS table
  const m = oldLines.length, n = newLines.length;
  // For large files skip LCS and just mark all as changed
  if (m * n > 40000) {
    return {
      lines: newLines.map((l, i) => ({ text: l, status: 'added', num: i + 1 })),
      hasChanges: true
    };
  }
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) dp[i][j] = dp[i+1][j+1] + 1;
      else dp[i][j] = Math.max(dp[i+1][j], dp[i][j+1]);
    }
  }
  // Trace back
  const result = [];
  let oi = 0, ni = 0;
  while (oi < m || ni < n) {
    if (oi < m && ni < n && oldLines[oi] === newLines[ni]) {
      result.push({ text: newLines[ni], status: 'same', num: ni + 1 });
      oi++; ni++;
    } else if (ni < n && (oi >= m || dp[oi][ni+1] >= dp[oi+1][ni])) {
      result.push({ text: newLines[ni], status: 'added', num: ni + 1 });
      ni++;
    } else {
      result.push({ text: oldLines[oi], status: 'removed', num: null });
      oi++;
    }
  }
  return { lines: result, hasChanges: true };
}

// ============================================================
// Render timeline
// ============================================================
function renderTimeline() {
  const list = document.getElementById('timeline-list');
  list.innerHTML = '';
  ops.forEach((op, i) => {
    const item = document.createElement('div');
    item.className = 'timeline-item type-' + op.type + (i === currentStep ? ' active' : '');
    item.dataset.idx = i;

    const gutter = document.createElement('div');
    gutter.className = 'timeline-gutter';
    gutter.title = 'Toggle breakpoint';
    const dot = document.createElement('div');
    dot.className = 'bp-dot' + (breakpoints.has(i) ? ' active-bp' : '');
    dot.dataset.idx = i;
    gutter.appendChild(dot);

    const line = document.createElement('div');
    line.className = 'tl-line';

    const icon = document.createElement('span');
    icon.className = 'tl-icon';
    icon.textContent = opIcon(op.type);

    const info = document.createElement('div');
    info.className = 'tl-info';

    const typeLine = document.createElement('div');
    typeLine.className = 'tl-type';
    typeLine.textContent = op.type;

    const targetLine = document.createElement('div');
    targetLine.className = 'tl-target';
    targetLine.title = op.target;
    targetLine.textContent = shortTarget(op.target);

    info.appendChild(typeLine);
    info.appendChild(targetLine);

    const ts = document.createElement('div');
    ts.className = 'tl-ts';
    ts.textContent = fmtTime(op.timestamp);

    line.appendChild(icon);
    line.appendChild(info);
    line.appendChild(ts);
    item.appendChild(gutter);
    item.appendChild(line);
    list.appendChild(item);

    // Events
    gutter.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(dot.dataset.idx, 10);
      if (breakpoints.has(idx)) breakpoints.delete(idx);
      else breakpoints.add(idx);
      dot.className = 'bp-dot' + (breakpoints.has(idx) ? ' active-bp' : '');
    });

    line.addEventListener('click', () => goToStep(i));
  });
}

// ============================================================
// Render tabs
// ============================================================
function renderTabs() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = '';
  const files = getAllFiles();
  if (files.length === 0) return;
  if (!activeFileTab || !files.includes(activeFileTab)) activeFileTab = files[0];
  files.forEach(f => {
    const tab = document.createElement('div');
    tab.className = 'file-tab' + (f === activeFileTab ? ' active' : '');
    tab.textContent = f.split('/').pop() || f;
    tab.title = f;
    tab.addEventListener('click', () => {
      activeFileTab = f;
      renderTabs();
      renderFileContent();
    });
    bar.appendChild(tab);
  });
}

// ============================================================
// Render file content
// ============================================================
function renderFileContent() {
  const area = document.getElementById('file-content-area');
  const banner = document.getElementById('diff-banner');
  banner.style.display = 'none';

  if (currentStep < 0 || !activeFileTab) {
    area.innerHTML = '<div class="file-placeholder"><span class="file-placeholder-icon">📂</span><span>Select a step to inspect file state</span></div>';
    return;
  }

  const curState = buildFileState(currentStep);
  const prevState = currentStep > 0 ? buildFileState(currentStep - 1) : {};

  const curContent = curState[activeFileTab] || null;
  const prevContent = prevState[activeFileTab] || null;

  if (curContent === null && prevContent === null) {
    area.innerHTML = '<div class="file-placeholder"><span class="file-placeholder-icon">📄</span><span style="color:var(--text-muted)">File not yet created at this step</span></div>';
    return;
  }

  const currentOp = ops[currentStep];
  const isActiveWrite = currentOp && (currentOp.type === 'write' || currentOp.type === 'create') && currentOp.target === activeFileTab;

  let diffResult = null;
  if (isActiveWrite || (curContent !== prevContent)) {
    diffResult = computeLineDiff(prevContent || '', curContent || '');
  }

  if (diffResult && diffResult.hasChanges) {
    const addedCount = diffResult.lines.filter(l => l.status === 'added').length;
    const removedCount = diffResult.lines.filter(l => l.status === 'removed').length;
    banner.style.display = 'block';
    banner.textContent = (isActiveWrite ? '✏️ Active write — ' : '🔍 Diff — ') + '+' + addedCount + ' / -' + removedCount + ' lines';
  }

  const lines = diffResult ? diffResult.lines : (curContent || '').split('\\n').map((l, i) => ({ text: l, status: 'same', num: i + 1 }));

  const pre = document.createElement('pre');
  pre.className = 'code-view';
  const code = document.createElement('code');

  lines.forEach(l => {
    const lineEl = document.createElement('div');
    lineEl.className = 'code-line' + (l.status === 'added' ? ' line-added' : l.status === 'removed' ? ' line-removed' : '');
    const numEl = document.createElement('span');
    numEl.className = 'line-num';
    numEl.textContent = l.num !== null ? String(l.num) : '-';
    const textEl = document.createElement('span');
    textEl.className = 'line-text';
    textEl.textContent = l.text;
    lineEl.appendChild(numEl);
    lineEl.appendChild(textEl);
    code.appendChild(lineEl);
  });

  pre.appendChild(code);
  area.innerHTML = '';
  area.appendChild(pre);
}

// ============================================================
// Render inspector
// ============================================================
function renderInspector() {
  const body = document.getElementById('inspector-body');
  if (currentStep < 0) {
    body.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Click a step to inspect.</div>';
    return;
  }
  const op = ops[currentStep];
  const total = ops.length;

  let html = '';

  // Step N of M
  html += '<div class="insp-section">';
  html += '<div class="insp-label">Step</div>';
  html += '<div class="insp-val purple">' + (currentStep + 1) + ' <span style="color:var(--text-muted)">of</span> ' + total + '</div>';
  html += '</div>';

  // Type
  html += '<div class="insp-section">';
  html += '<div class="insp-label">Type</div>';
  html += '<div class="insp-val" style="color:' + (OP_COLOR[op.type] || '#aaa') + '">' + opIcon(op.type) + ' ' + op.type + '</div>';
  html += '</div>';

  // Target
  html += '<div class="insp-section">';
  html += '<div class="insp-label">Target</div>';
  html += '<div class="insp-val mono">' + escHtml(op.target) + '</div>';
  html += '</div>';

  // Timestamp
  html += '<div class="insp-section">';
  html += '<div class="insp-label">Timestamp</div>';
  html += '<div class="insp-val mono" style="font-size:11px">' + new Date(op.timestamp).toISOString() + '</div>';
  html += '</div>';

  // Reason
  if (op.reason) {
    html += '<div class="insp-section">';
    html += '<div class="insp-label">Reason</div>';
    html += '<div class="insp-val">' + escHtml(op.reason) + '</div>';
    html += '</div>';
  }

  // CausedBy
  if (op.causedBy && op.causedBy.length > 0) {
    html += '<div class="insp-section">';
    html += '<div class="insp-label">Caused By</div>';
    html += '<div class="insp-val">';
    op.causedBy.forEach(cid => {
      const cidx = ops.findIndex(o => o.id === cid);
      if (cidx >= 0) {
        html += '<a class="causedby-link" data-step="' + cidx + '" title="' + escHtml(cid) + '">' + escHtml(cid.slice(0, 8)) + '…</a>';
      }
    });
    html += '</div></div>';
  }

  // Metadata extras
  const meta = op.metadata || {};
  if (meta.exitCode !== undefined) {
    html += '<div class="insp-section">';
    html += '<div class="insp-label">Exit Code</div>';
    html += '<div class="insp-val mono" style="color:' + (meta.exitCode === 0 ? 'var(--green)' : 'var(--red)') + '">' + meta.exitCode + '</div>';
    html += '</div>';
  }
  if (meta.command) {
    html += '<div class="insp-section">';
    html += '<div class="insp-label">Command</div>';
    html += '<div class="insp-val mono">' + escHtml(meta.command) + '</div>';
    html += '</div>';
  }

  html += '<hr class="insp-divider">';

  // Tape/prediction panel
  if (TAPE) {
    if (TAPE.modelVersion) {
      html += '<div class="insp-section">';
      html += '<div class="insp-label">Model Version</div>';
      html += '<div class="insp-val mono cyan">' + escHtml(String(TAPE.modelVersion)) + '</div>';
      html += '</div>';
    }
    if (TAPE.hash) {
      html += '<div class="insp-section">';
      html += '<div class="insp-label">Tape Hash</div>';
      html += '<div class="insp-val mono" style="font-size:11px">' + escHtml(String(TAPE.hash).slice(0, 8)) + '</div>';
      html += '</div>';
    }
    html += '<hr class="insp-divider">';
  }

  // Fork button
  html += '<button class="fork-btn" id="fork-btn-action">Fork from here →</button>';

  body.innerHTML = html;

  // Wire causedBy links
  body.querySelectorAll('.causedby-link').forEach(el => {
    el.addEventListener('click', () => goToStep(parseInt(el.dataset.step, 10)));
  });

  // Fork button
  const forkBtn = document.getElementById('fork-btn-action');
  if (forkBtn) {
    forkBtn.addEventListener('click', () => showForkModal(currentStep));
  }
}

// ============================================================
// Go to step
// ============================================================
function goToStep(idx) {
  if (idx < 0) idx = 0;
  if (idx >= ops.length) idx = ops.length - 1;
  currentStep = idx;
  updateUI();
}

function updateUI() {
  // Update timeline highlight
  document.querySelectorAll('.timeline-item').forEach((el, i) => {
    el.classList.toggle('active', i === currentStep);
  });

  // Scroll active item into view
  const activeItem = document.querySelector('.timeline-item.active');
  if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });

  // Update scrubber
  const pct = ops.length <= 1 ? 0 : (currentStep / (ops.length - 1)) * 100;
  document.getElementById('scrubber-fill').style.width = pct + '%';
  document.getElementById('scrubber-thumb').style.left = pct + '%';

  // Step counter
  document.getElementById('step-counter').textContent = (currentStep + 1) + ' / ' + ops.length;

  // File panel
  renderTabs();
  renderFileContent();

  // Inspector
  renderInspector();
}

// ============================================================
// Auto-play
// ============================================================
function startPlay() {
  if (isPlaying) return;
  isPlaying = true;
  document.getElementById('btn-play').textContent = '⏸';
  scheduleNextStep();
}

function pausePlay() {
  isPlaying = false;
  document.getElementById('btn-play').textContent = '▶';
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
}

function scheduleNextStep() {
  if (!isPlaying) return;
  const delay = Math.round(1000 / playSpeed);
  playTimer = setTimeout(() => {
    if (!isPlaying) return;
    const nextStep = currentStep + 1;
    if (nextStep >= ops.length) {
      // Loop back
      goToStep(0);
      scheduleNextStep();
      return;
    }
    goToStep(nextStep);
    // Pause at breakpoints
    if (breakpoints.has(nextStep)) {
      pausePlay();
      return;
    }
    scheduleNextStep();
  }, delay);
}

// ============================================================
// Fork modal
// ============================================================
function showForkModal(stepIdx) {
  const op = ops[stepIdx];
  const cmd = 'agentgram fork ' + SESSION.id + ' --from ' + (op ? op.id : stepIdx);
  document.getElementById('fork-cmd').textContent = cmd;
  document.getElementById('fork-modal').style.display = 'flex';
}

document.getElementById('fork-close').addEventListener('click', () => {
  document.getElementById('fork-modal').style.display = 'none';
});

// ============================================================
// Transport controls
// ============================================================
document.getElementById('btn-first').addEventListener('click', () => { pausePlay(); goToStep(0); });
document.getElementById('btn-prev').addEventListener('click', () => { pausePlay(); goToStep(currentStep - 1); });
document.getElementById('btn-next').addEventListener('click', () => { pausePlay(); goToStep(currentStep + 1); });
document.getElementById('btn-last').addEventListener('click', () => { pausePlay(); goToStep(ops.length - 1); });

document.getElementById('btn-play').addEventListener('click', () => {
  if (isPlaying) pausePlay();
  else {
    if (currentStep >= ops.length - 1) goToStep(0);
    startPlay();
  }
});

// Speed buttons
document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    playSpeed = parseFloat(btn.dataset.speed);
  });
});

// Scrubber
const scrubContainer = document.getElementById('scrubber-container');
scrubContainer.addEventListener('click', (e) => {
  const rect = scrubContainer.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const idx = Math.round(pct * (ops.length - 1));
  pausePlay();
  goToStep(idx);
});

// Export tape
document.getElementById('btn-export').addEventListener('click', () => {
  if (!TAPE) { alert('No tape data available for this session.'); return; }
  const blob = new Blob([JSON.stringify(TAPE, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'agentgram-tape-' + SESSION.id + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

// Keyboard
document.addEventListener('keydown', (e) => {
  // Don't interfere with inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); pausePlay(); goToStep(currentStep + 1); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); pausePlay(); goToStep(currentStep - 1); }
  else if (e.key === ' ') { e.preventDefault(); if (isPlaying) pausePlay(); else { if (currentStep >= ops.length - 1) goToStep(0); startPlay(); } }
});

// Tape hash badge
if (TAPE && TAPE.hash) {
  const badge = document.getElementById('dbg-tape-hash');
  badge.textContent = 'tape: ' + String(TAPE.hash).slice(0, 8);
  badge.style.display = '';
}

// ============================================================
// HTML escape for inline use
// ============================================================
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// Init
// ============================================================
renderTimeline();
renderTabs();
if (ops.length > 0) goToStep(0);

</script>
</body>
</html>`;
}

