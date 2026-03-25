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
