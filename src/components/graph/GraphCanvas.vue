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
let svg, simulation

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

  const g = svg.append('g')

  // Zoom
  const zoom = d3.zoom()
    .scaleExtent([0.3, 5])
    .on('zoom', (event) => g.attr('transform', event.transform))
  svg.call(zoom)

  // Prepare data
  const nodeMap = new Map(props.nodes.map(n => [n.id, { ...n }]))
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
  const link = g.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', '#f9a8d4')
    .attr('stroke-width', d => Math.min(d.weight, 5))
    .attr('stroke-opacity', 0.5)

  // Edge labels
  const linkLabel = g.append('g')
    .selectAll('text')
    .data(links)
    .join('text')
    .text(d => d.relation)
    .attr('font-size', '8px')
    .attr('fill', '#9d174d')
    .attr('text-anchor', 'middle')

  // Nodes
  const node = g.append('g')
    .selectAll('circle')
    .data(nodeData)
    .join('circle')
    .attr('r', d => Math.min(8 + d.weight * 2, 25))
    .attr('fill', d => typeColors[d.type] || '#888')
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 2)
    .attr('cursor', 'pointer')
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
  const label = g.append('g')
    .selectAll('text')
    .data(nodeData)
    .join('text')
    .text(d => d.label)
    .attr('font-size', '11px')
    .attr('fill', '#831843')
    .attr('dx', 12)
    .attr('dy', 4)
    .attr('pointer-events', 'none')

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y)
    linkLabel
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2)
    node
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
    label
      .attr('x', d => d.x)
      .attr('y', d => d.y)
  })
}

function highlightSearch() {
  if (!svg || !props.nodes.length) return
  const q = props.searchQuery?.toLowerCase()
  svg.selectAll('circle')
    .attr('opacity', d => !q || d.label.toLowerCase().includes(q) ? 1 : 0.2)
  svg.selectAll('text')
    .attr('opacity', function(d) {
      if (!d?.label) return 1
      return !q || d.label.toLowerCase().includes(q) ? 1 : 0.2
    })
}

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
