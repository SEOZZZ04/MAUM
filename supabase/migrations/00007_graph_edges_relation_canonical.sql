-- Normalize graph_edges.relation to canonical English values and extend allowed enum set.
-- Option A adopted: store only canonical English relations in DB.

-- 1) Backfill pre-existing non-canonical (including Korean) relations.
UPDATE public.graph_edges
SET relation = CASE relation
  WHEN '원인됨' THEN 'causes'
  WHEN '관련됨' THEN 'relates_to'
  WHEN '유발함' THEN 'triggers'
  WHEN '해결함' THEN 'resolves'
  WHEN '선호함' THEN 'prefers'
  WHEN '회피함' THEN 'avoids'
  WHEN '갈등됨' THEN 'conflicts_with'
  WHEN '지지함' THEN 'supports'
  WHEN '언급함' THEN 'mentions'
  WHEN '느낌' THEN 'feels'
  WHEN '계획함' THEN 'planned_for'
  WHEN '방문함' THEN 'visits'
  WHEN '참여함' THEN 'participates_in'
  WHEN '부분임' THEN 'part_of'
  WHEN 'related_to' THEN 'relates_to'
  WHEN 'plans_for' THEN 'planned_for'
  WHEN 'participates' THEN 'participates_in'
  WHEN 'partof' THEN 'part_of'
  ELSE relation
END;

-- 2) Redefine relation check constraint to canonical values only.
ALTER TABLE public.graph_edges
DROP CONSTRAINT IF EXISTS graph_edges_relation_check;

ALTER TABLE public.graph_edges
ADD CONSTRAINT graph_edges_relation_check
CHECK (
  relation IN (
    'causes',
    'relates_to',
    'triggers',
    'resolves',
    'prefers',
    'avoids',
    'conflicts_with',
    'supports',
    'mentions',
    'feels',
    'planned_for',
    'visits',
    'participates_in',
    'part_of'
  )
);
