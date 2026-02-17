const baseRelationLabelMap = {
  avoids: '거리를둠',
  conflicts_with: '부딪힘',
  mentions: '꺼내봄',
  feels: '느껴짐',
  visits: '찾아감',
  participates_in: '함께함',
  part_of: '스며있음'
}

function normalizeText(value) {
  return (value || '').trim().toLowerCase()
}

function getNodeInfo(nodeDataMap, nodeId) {
  const node = nodeDataMap.get(nodeId) || {}
  return {
    type: node.type,
    label: normalizeText(node.label)
  }
}

function getCausesLabel(source, target) {
  if (source.type === 'value' || source.type === 'habit') return '이끌었음'
  if (target.type === 'emotion') return '불러옴'
  if (target.label.includes('추억') || target.label.includes('여운')) return '남겼음'
  return '불러옴'
}

function getRelatesToLabel(source, target) {
  if (source.type === 'person' && target.type === 'person') return '닮아있음'
  if (
    (source.type === 'person' && ['event', 'plan'].includes(target.type))
    || (target.type === 'person' && ['event', 'plan'].includes(source.type))
  ) return '함께함'
  return '이어짐'
}

function getTriggersLabel(source, target) {
  const joined = `${source.label} ${target.label}`

  if (/싸움|다툼|갈등|분노|폭발/.test(joined)) return '터트림'
  if ((source.type === 'emotion' || target.type === 'emotion') && /우울|불안|눈물|외로움/.test(joined)) return '물들임'
  if (/선물|칭찬|응원|데이트|축하/.test(joined)) return '돋우어줌'

  return target.type === 'emotion' ? '물들임' : '터트림'
}

function getResolvesLabel(source, target) {
  const joined = `${source.label} ${target.label}`

  if (source.type === 'person' && /실수|약점|불안|상처/.test(joined)) return '감싸줌'
  return '녹여줌'
}

function getSupportsLabel(source, target) {
  if (source.type === 'person' || target.type === 'person') return '감싸줌'
  return '받쳐줌'
}

function getRelationByCanonical(canonical, source, target) {
  switch (canonical) {
    case 'causes':
      return getCausesLabel(source, target)
    case 'relates_to':
    case 'related_to':
      return getRelatesToLabel(source, target)
    case 'triggers':
      return getTriggersLabel(source, target)
    case 'resolves':
      return getResolvesLabel(source, target)
    case 'supports':
      return getSupportsLabel(source, target)
    case 'prefers':
      return '꽂혀있음'
    case 'planned_for':
      return '꿈꾸는중'
    default:
      return baseRelationLabelMap[canonical]
  }
}

export function getEdgeRelationLabel(edge, nodeDataMap = new Map()) {
  const normalized = normalizeText(edge?.relation).replace(/[\s-]+/g, '_')
  const source = getNodeInfo(nodeDataMap, edge?.source_node_id)
  const target = getNodeInfo(nodeDataMap, edge?.target_node_id)

  return getRelationByCanonical(normalized, source, target) || edge?.relation || '이어짐'
}
}
