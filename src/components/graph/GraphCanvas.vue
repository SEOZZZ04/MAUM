<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as d3 from 'd3'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  edges: { type: Array, default: () => [] },
  searchQuery: { type: String, default: '' }
})

const emit = defineEmits(['node-click'])

const container = ref(null)
let svg, simulation, zoomBehavior, gGroup
// Keep references for search-zoom
let nodeElements, labelElements, linkElements, linkLabelElements
let nodeDataMap = new Map()

const typeColors = {
  person: '#ec4899',
  topic: '#a78bfa',
  event: '#fb923c',
  emotion: '#f87171',
  habit: '#34d399',
  value: '#60a5fa',
  place: '#22d3ee',
  plan: '#fbbf24'
}

function buildGraph() {
  if (!container.value || !props.nodes.length) return

  const el = container.value
  const width = el.clientWidth
  const height = el.clientHeight

  d3.select(el).selectAll('*').remove()

  svg = d3.select(el)
    .append('svg')
    .attr('width', width)
    .attr('height', height)

  gGroup = svg.append('g')

  // Zoom
  zoomBehavior = d3.zoom()
    .scaleExtent([0.3, 5])
    .on('zoom', (event) => gGroup.attr('transform', event.transform))
  svg.call(zoomBehavior)

  // Prepare data
  const nodeMap = new Map(props.nodes.map(n => [n.id, { ...n }]))
  nodeDataMap = nodeMap
  const links = props.edges
    .filter(e => nodeMap.has(e.source_node_id) && nodeMap.has(e.target_node_id))
    .map(e => ({
      ...e,
      source: e.source_node_id,
      target: e.target_node_id
    }))
  const nodeData = Array.from(nodeMap.values())

  // Simulation
  simulation = d3.forceSimulation(nodeData)
    .force('link', d3.forceLink(links).id(d => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(30))

  // Edges
  linkElements = gGroup.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', '#f9a8d4')
    .attr('stroke-width', d => Math.min(d.weight, 5))
    .attr('stroke-opacity', 0.4)

  // Edge labels
  linkLabelElements = gGroup.append('g')
    .selectAll('text')
    .data(links)
    .join('text')
    .text(d => d.relation)
    .attr('font-size', '8px')
    .attr('fill', '#b5678e')
    .attr('text-anchor', 'middle')
    .attr('opacity', 0.7)

  // Nodes
  nodeElements = gGroup.append('g')
    .selectAll('circle')
    .data(nodeData)
    .join('circle')
    .attr('r', d => Math.min(8 + d.weight * 2, 25))
    .attr('fill', d => typeColors[d.type] || '#888')
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 2)
    .attr('cursor', 'pointer')
    .attr('filter', 'none')
    .on('click', (event, d) => emit('node-click', d))
    .call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x; d.fy = d.y
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null; d.fy = null
      })
    )

  // Labels
  labelElements = gGroup.append('g')
    .selectAll('text')
    .data(nodeData)
    .join('text')
    .text(d => d.label)
    .attr('font-size', '11px')
    .attr('fill', '#6b3a5c')
    .attr('dx', 12)
    .attr('dy', 4)
    .attr('pointer-events', 'none')

  simulation.on('tick', () => {
    linkElements
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y)
    linkLabelElements
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2)
    nodeElements
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
    labelElements
      .attr('x', d => d.x)
      .attr('y', d => d.y)
  })
}

function highlightSearch() {
  if (!svg || !props.nodes.length || !nodeElements) return
  const q = props.searchQuery?.toLowerCase()

  if (!q) {
    // Reset all to full opacity
    nodeElements.attr('opacity', 1).attr('stroke-width', 2).attr('stroke', '#ffffff')
    labelElements.attr('opacity', 1).attr('font-weight', 'normal')
    linkElements.attr('stroke-opacity', 0.4)
    linkLabelElements.attr('opacity', 0.7)
    return
  }

  // Find matching node IDs
  const matchingIds = new Set()
  nodeElements.each(function(d) {
    if (d.label.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)) {
      matchingIds.add(d.id)
    }
  })

  // Find related node IDs (connected via edges)
  const relatedIds = new Set()
  linkElements.each(function(d) {
    const srcId = typeof d.source === 'object' ? d.source.id : d.source
    const tgtId = typeof d.target === 'object' ? d.target.id : d.target
    if (matchingIds.has(srcId)) relatedIds.add(tgtId)
    if (matchingIds.has(tgtId)) relatedIds.add(srcId)
  })

  // Highlight matching nodes with glow, related with softer highlight, dim others
  nodeElements
    .attr('opacity', d => {
      if (matchingIds.has(d.id)) return 1
      if (relatedIds.has(d.id)) return 0.8
      return 0.15
    })
    .attr('stroke-width', d => matchingIds.has(d.id) ? 4 : 2)
    .attr('stroke', d => matchingIds.has(d.id) ? '#fbbf24' : (relatedIds.has(d.id) ? '#fde68a' : '#ffffff'))

  labelElements
    .attr('opacity', d => {
      if (!d?.label) return 0.15
      if (matchingIds.has(d.id)) return 1
      if (relatedIds.has(d.id)) return 0.7
      return 0.1
    })
    .attr('font-weight', d => matchingIds.has(d.id) ? 'bold' : 'normal')

  // Highlight connected edges
  linkElements
    .attr('stroke-opacity', d => {
      const srcId = typeof d.source === 'object' ? d.source.id : d.source
      const tgtId = typeof d.target === 'object' ? d.target.id : d.target
      if (matchingIds.has(srcId) || matchingIds.has(tgtId)) return 0.8
      return 0.08
    })
    .attr('stroke', d => {
      const srcId = typeof d.source === 'object' ? d.source.id : d.source
      const tgtId = typeof d.target === 'object' ? d.target.id : d.target
      if (matchingIds.has(srcId) || matchingIds.has(tgtId)) return '#f472b6'
      return '#f9a8d4'
    })

  linkLabelElements
    .attr('opacity', d => {
      const srcId = typeof d.source === 'object' ? d.source.id : d.source
      const tgtId = typeof d.target === 'object' ? d.target.id : d.target
      if (matchingIds.has(srcId) || matchingIds.has(tgtId)) return 1
      return 0.05
    })
}

// Zoom to matching nodes with smooth animation
function zoomToSearch(query) {
  if (!svg || !nodeElements || !query) return

  const q = query.toLowerCase()
  const matchingNodes = []

  nodeElements.each(function(d) {
    if (d.label.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)) {
      matchingNodes.push(d)
    }
  })

  if (matchingNodes.length === 0) return

  const el = container.value
  const width = el.clientWidth
  const height = el.clientHeight

  // Calculate bounding box of all matching nodes
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  matchingNodes.forEach(n => {
    if (n.x < minX) minX = n.x
    if (n.x > maxX) maxX = n.x
    if (n.y < minY) minY = n.y
    if (n.y > maxY) maxY = n.y
  })

  // Add padding
  const padding = 80
  minX -= padding; maxX += padding; minY -= padding; maxY += padding

  // Calculate zoom transform to fit all matching nodes
  const dx = maxX - minX
  const dy = maxY - minY
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const scale = Math.min(width / dx, height / dy, 2.5)

  const transform = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-cx, -cy)

  // Smooth animated transition
  svg.transition()
    .duration(750)
    .ease(d3.easeCubicInOut)
    .call(zoomBehavior.transform, transform)
}

// Expose zoomToSearch for parent component to call
defineExpose({ zoomToSearch })

watch(() => [props.nodes, props.edges], () => {
  nextTick(buildGraph)
}, { deep: true })

watch(() => props.searchQuery, highlightSearch)

onMounted(() => nextTick(buildGraph))

onUnmounted(() => {
  if (simulation) simulation.stop()
})
</script>

<template>
  <div ref="container" class="w-full h-full"></div>
</template>
