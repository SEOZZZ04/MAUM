const relationLabelMap = {
  causes: '원인됨',
  relates_to: '관련됨',
  triggers: '야기함',
  resolves: '해결함',
  prefers: '선호함',
  avoids: '회피함',
  conflicts_with: '갈등됨',
  supports: '지지함',
  mentions: '언급함',
  feels: '표현함',
  planned_for: '계획함',
  visits: '방문함',
  participates_in: '참여함',
  part_of: '부분임'
}

function getContextualRelatesToLabel(sourceType, targetType) {
  if (sourceType === 'event' && targetType === 'emotion') return '야기함'
  if (sourceType === 'emotion' && targetType !== 'emotion') return '표현함'
  if (sourceType === 'person' && targetType === 'emotion') return '표현함'
  if (sourceType === 'plan' && (targetType === 'event' || targetType === 'place')) return '발생함'
  return '관련됨'
}

export function getEdgeRelationLabel(edge, nodeDataMap = new Map()) {
  const normalized = (edge?.relation || '').trim().toLowerCase().replace(/[\s-]+/g, '_')

  if (normalized === 'related_to') {
    // Backward compatibility for old relation values
    return getContextualRelatesToLabel(
      nodeDataMap.get(edge?.source_node_id)?.type,
      nodeDataMap.get(edge?.target_node_id)?.type
    )
  }

  if (normalized === 'relates_to') {
    return getContextualRelatesToLabel(
      nodeDataMap.get(edge?.source_node_id)?.type,
      nodeDataMap.get(edge?.target_node_id)?.type
    )
  }

  return relationLabelMap[normalized] || edge?.relation || '관련됨'
}
