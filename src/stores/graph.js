import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { useCoupleStore } from './couple'

export const useGraphStore = defineStore('graph', () => {
  const nodes = ref([])
  const edges = ref([])
  const loading = ref(false)
  const searchQuery = ref('')
  let realtimeChannel = null

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

  // Subscribe to real-time graph changes so new nodes/edges appear live
  function subscribeToGraphChanges() {
    unsubscribeFromGraphChanges()
    const couple = useCoupleStore()
    if (!couple.coupleId) return

    realtimeChannel = supabase
      .channel(`graph:${couple.coupleId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'graph_nodes',
        filter: `couple_id=eq.${couple.coupleId}`
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          // Add new node if not already present
          if (!nodes.value.some(n => n.id === payload.new.id)) {
            nodes.value.push(payload.new)
          }
        } else if (payload.eventType === 'UPDATE') {
          const idx = nodes.value.findIndex(n => n.id === payload.new.id)
          if (idx !== -1) nodes.value[idx] = payload.new
        } else if (payload.eventType === 'DELETE') {
          nodes.value = nodes.value.filter(n => n.id !== payload.old.id)
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'graph_edges',
        filter: `couple_id=eq.${couple.coupleId}`
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          if (!edges.value.some(e => e.id === payload.new.id)) {
            edges.value.push(payload.new)
          }
        } else if (payload.eventType === 'UPDATE') {
          const idx = edges.value.findIndex(e => e.id === payload.new.id)
          if (idx !== -1) edges.value[idx] = payload.new
        } else if (payload.eventType === 'DELETE') {
          edges.value = edges.value.filter(e => e.id !== payload.old.id)
        }
      })
      .subscribe()
  }

  function unsubscribeFromGraphChanges() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel)
      realtimeChannel = null
    }
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

  async function resetGraph() {
    const couple = useCoupleStore()
    if (!couple.coupleId) return

    loading.value = true
    const [{ error: edgesError }, { error: nodesError }] = await Promise.all([
      supabase
        .from('graph_edges')
        .delete()
        .eq('couple_id', couple.coupleId),
      supabase
        .from('graph_nodes')
        .delete()
        .eq('couple_id', couple.coupleId)
    ])

    if (edgesError || nodesError) {
      loading.value = false
      throw edgesError || nodesError
    }

    nodes.value = []
    edges.value = []
    searchQuery.value = ''
    loading.value = false
  }

  return {
    nodes, edges, loading, searchQuery,
    fetchGraph, searchNodes, getRelatedEdges,
    subscribeToGraphChanges, unsubscribeFromGraphChanges,
    resetGraph
  }
})
