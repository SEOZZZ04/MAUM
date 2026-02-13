import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { useCoupleStore } from './couple'

export const useGraphStore = defineStore('graph', () => {
  const nodes = ref([])
  const edges = ref([])
  const loading = ref(false)
  const searchQuery = ref('')

  async function fetchGraph() {
    const couple = useCoupleStore()
    if (!couple.coupleId) return
    loading.value = true

    const [nodesRes, edgesRes] = await Promise.all([
      supabase
        .from('graph_nodes')
        .select('*')
        .eq('couple_id', couple.coupleId)
        .order('weight', { ascending: false }),
      supabase
        .from('graph_edges')
        .select('*')
        .eq('couple_id', couple.coupleId)
        .order('weight', { ascending: false })
    ])

    nodes.value = nodesRes.data || []
    edges.value = edgesRes.data || []
    loading.value = false
  }

  function searchNodes(query) {
    searchQuery.value = query
    if (!query) return nodes.value
    const q = query.toLowerCase()
    return nodes.value.filter(n =>
      n.label.toLowerCase().includes(q) ||
      n.type.toLowerCase().includes(q)
    )
  }

  function getRelatedEdges(nodeId) {
    return edges.value.filter(e =>
      e.source_node_id === nodeId || e.target_node_id === nodeId
    )
  }

  return {
    nodes, edges, loading, searchQuery,
    fetchGraph, searchNodes, getRelatedEdges
  }
})
