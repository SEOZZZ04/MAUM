-- Graph schema enhancements: relation taxonomy, provenance, metadata conventions, and compatibility views.

-- 1) Canonicalize and expand graph edge relations
CREATE OR REPLACE FUNCTION public.normalize_graph_relation(input_relation text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(input_relation))
    WHEN '원인됨' THEN 'causes'
    WHEN '관련됨' THEN 'relates_to'
    WHEN '유발함' THEN 'triggers'
    WHEN '해결함' THEN 'resolves'
    WHEN '선호함' THEN 'prefers'
    WHEN '회피함' THEN 'avoids'
    WHEN '갈등됨' THEN 'conflicts_with'
    WHEN '지지함' THEN 'supports'
    WHEN '언급함' THEN 'mentioned_by'
    WHEN '느낌' THEN 'relates_to'
    WHEN '계획함' THEN 'planned_for'
    WHEN '방문함' THEN 'part_of'
    WHEN '참여함' THEN 'instance_of'
    ELSE lower(trim(input_relation))
  END
$$;

CREATE OR REPLACE FUNCTION public.trg_normalize_graph_edges_relation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.relation := public.normalize_graph_relation(NEW.relation);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_graph_edges_relation ON public.graph_edges;
CREATE TRIGGER normalize_graph_edges_relation
BEFORE INSERT OR UPDATE ON public.graph_edges
FOR EACH ROW
EXECUTE FUNCTION public.trg_normalize_graph_edges_relation();

ALTER TABLE public.graph_edges
  DROP CONSTRAINT IF EXISTS graph_edges_relation_check;

ALTER TABLE public.graph_edges
  ADD CONSTRAINT graph_edges_relation_check
  CHECK (
    relation IN (
      'causes','relates_to','triggers','resolves','prefers','avoids','conflicts_with','supports',
      'part_of','instance_of','planned_for','requires','mentioned_by'
    )
  );

-- 2) Provenance fields
ALTER TABLE public.graph_nodes
  ADD COLUMN IF NOT EXISTS source_day_id uuid REFERENCES public.conversation_days(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_message_window jsonb,
  ADD COLUMN IF NOT EXISTS extraction_batch_id uuid;

ALTER TABLE public.graph_edges
  ADD COLUMN IF NOT EXISTS source_day_id uuid REFERENCES public.conversation_days(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_message_window jsonb,
  ADD COLUMN IF NOT EXISTS extraction_batch_id uuid;

-- 3) Seed/hub metadata convention
ALTER TABLE public.graph_nodes
  ADD CONSTRAINT graph_nodes_metadata_seed_convention_check
  CHECK (
    (NOT (metadata ? 'is_seed') OR jsonb_typeof(metadata->'is_seed') = 'boolean')
    AND (NOT (metadata ? 'seed_confidence') OR (
      jsonb_typeof(metadata->'seed_confidence') = 'number'
      AND (metadata->>'seed_confidence')::numeric >= 0
      AND (metadata->>'seed_confidence')::numeric <= 1
    ))
    AND (NOT (metadata ? 'time_scope') OR (
      jsonb_typeof(metadata->'time_scope') = 'string'
      AND metadata->>'time_scope' IN ('day','week','month','quarter','year','all','custom')
    ))
  );

COMMENT ON COLUMN public.graph_nodes.metadata IS
'Hub metadata convention: {"is_seed": boolean, "seed_confidence": 0..1, "time_scope": "day|week|month|quarter|year|all|custom"}';

COMMENT ON COLUMN public.graph_nodes.source_day_id IS 'Provenance: conversation_days.id where this node was extracted.';
COMMENT ON COLUMN public.graph_nodes.source_message_window IS 'Provenance: JSON window descriptor (e.g. {"start_message_id":...,"end_message_id":...}).';
COMMENT ON COLUMN public.graph_nodes.extraction_batch_id IS 'Provenance: ID grouping one extraction run.';

COMMENT ON COLUMN public.graph_edges.source_day_id IS 'Provenance: conversation_days.id where this edge was extracted.';
COMMENT ON COLUMN public.graph_edges.source_message_window IS 'Provenance: JSON window descriptor (e.g. {"start_message_id":...,"end_message_id":...}).';
COMMENT ON COLUMN public.graph_edges.extraction_batch_id IS 'Provenance: ID grouping one extraction run.';

-- 4) Index 강화
CREATE INDEX IF NOT EXISTS idx_graph_nodes_couple_type_weight
  ON public.graph_nodes(couple_id, type, weight DESC);

CREATE INDEX IF NOT EXISTS idx_graph_edges_couple_relation_weight
  ON public.graph_edges(couple_id, relation, weight DESC);

-- 5) Compatibility transform layer for legacy queries
CREATE OR REPLACE VIEW public.graph_nodes_legacy AS
SELECT
  id,
  couple_id,
  label,
  type,
  weight,
  last_seen_at,
  metadata
FROM public.graph_nodes;

CREATE OR REPLACE VIEW public.graph_edges_legacy AS
SELECT
  id,
  couple_id,
  source_node_id,
  target_node_id,
  CASE relation
    WHEN 'part_of' THEN 'relates_to'
    WHEN 'instance_of' THEN 'relates_to'
    WHEN 'planned_for' THEN 'triggers'
    WHEN 'requires' THEN 'supports'
    WHEN 'mentioned_by' THEN 'relates_to'
    ELSE relation
  END AS relation,
  weight,
  last_seen_at,
  evidence
FROM public.graph_edges;
