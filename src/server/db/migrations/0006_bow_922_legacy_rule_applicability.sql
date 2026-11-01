-- Explicit custom DATA migration created with drizzle-kit --custom.
-- 0005 remains the untouched generated structure migration.
-- Freeze existing usage facts while deriving only the two known legacy categories.
-- Match the category writer's advisory-lock order; do not infer a publication time.
LOCK TABLE evaluation_rule_versions, records_events,
  records_historical_evaluations IN SHARE MODE;
--> statement-breakpoint
SELECT pg_advisory_xact_lock(hashtextextended('qtalent:rule-category:dimension_anchors', 0));
--> statement-breakpoint
SELECT pg_advisory_xact_lock(hashtextextended('qtalent:rule-category:xe_weekly', 0));
--> statement-breakpoint
DO $migration$
DECLARE unresolved text[];
BEGIN
  WITH missing AS (
    SELECT v.id FROM evaluation_rule_versions AS v
    WHERE v.id IN ('rubric-v1', 'xe-weekly-v1')
      AND NOT EXISTS (
        SELECT 1 FROM evaluation_rule_version_applicability AS a
        WHERE a.version_id = v.id
      )
  ), usages AS (
    SELECT rule_version_id AS version_id, occurred_on AS used_on
    FROM records_events WHERE occurred_on IS NOT NULL
    UNION ALL
    SELECT rule_version_id AS version_id, occurred_on AS used_on
    FROM records_historical_evaluations WHERE occurred_on IS NOT NULL
  )
  SELECT array_agg(id ORDER BY id) INTO unresolved FROM (
    SELECT m.id FROM missing AS m LEFT JOIN usages AS u ON u.version_id = m.id
    GROUP BY m.id
    HAVING count(u.used_on) = 0 OR bool_or(NOT isfinite(u.used_on))
  ) AS invalid;
  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22007',
      MESSAGE = 'Legacy rule applicability requires validated usage dates: '
        || array_to_string(unresolved, ', ');
  END IF;
END
$migration$;
--> statement-breakpoint
-- A version with ANY existing interval (including closed/restored ones) is left alone.
-- Unknown version IDs receive no category or fallback timestamp.
WITH usages AS (
  SELECT rule_version_id AS version_id, occurred_on AS used_on
  FROM records_events WHERE occurred_on IS NOT NULL
  UNION ALL
  SELECT rule_version_id AS version_id, occurred_on AS used_on
  FROM records_historical_evaluations WHERE occurred_on IS NOT NULL
)
INSERT INTO evaluation_rule_version_applicability
  (period_id, version_id, category, effective_from, effective_until)
SELECT 'legacy:' || v.id, v.id,
  CASE v.id WHEN 'rubric-v1' THEN 'dimension_anchors' ELSE 'xe_weekly' END,
  min(u.used_on)::timestamp AT TIME ZONE 'UTC', NULL
FROM evaluation_rule_versions AS v JOIN usages AS u ON u.version_id = v.id
WHERE v.id IN ('rubric-v1', 'xe-weekly-v1')
  AND NOT EXISTS (
    SELECT 1 FROM evaluation_rule_version_applicability AS a
    WHERE a.version_id = v.id
  )
GROUP BY v.id;
