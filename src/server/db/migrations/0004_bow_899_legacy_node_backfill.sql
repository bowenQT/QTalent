-- Explicit custom DATA migration, generated with drizzle-kit --custom.
-- 0003 is the untouched Drizzle-generated structure migration.
-- Keep the legacy snapshot stable until its one-time authorization transition commits.
LOCK TABLE programs_cohorts, programs_enrollments, programs_assignments,
  staffing_projects IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO programs_evaluation_nodes (id, name, kind, cohort_id)
SELECT 'cohort:' || id, name, 'program_cohort', id FROM programs_cohorts;
--> statement-breakpoint
INSERT INTO programs_evaluation_node_subjects (evaluation_node_id, person_id)
SELECT 'cohort:' || membership.cohort_id, membership.person_id
FROM (
  SELECT cohort_id, person_id FROM programs_enrollments
  UNION
  SELECT cohort_id, student_id AS person_id FROM programs_assignments
) AS membership
JOIN programs_cohorts AS c ON c.id = membership.cohort_id
JOIN directory_people AS p ON p.id = membership.person_id;
--> statement-breakpoint
INSERT INTO programs_evaluation_relations
  (id, evaluation_node_id, person_id, evaluator_id, kind,
   valid_from, valid_to, revoked_at, legacy_assignment_id)
SELECT 'assignment:' || a.id, 'cohort:' || a.cohort_id, a.student_id, a.person_id,
  a.kind, a.valid_from::timestamp AT TIME ZONE 'UTC',
  a.valid_to::timestamp AT TIME ZONE 'UTC',
  a.revoked_at::timestamp AT TIME ZONE 'UTC', a.id
FROM programs_assignments AS a
JOIN programs_cohorts AS c ON c.id = a.cohort_id
JOIN directory_people AS subject ON subject.id = a.student_id
JOIN directory_people AS evaluator ON evaluator.id = a.person_id;
--> statement-breakpoint
-- The event's historical date and (when present) its actual project's cohort
-- must identify exactly one node. A person's current cohort is never a fallback.
WITH memberships AS (
  SELECT cohort_id, person_id, valid_from, valid_to, revoked_at
  FROM programs_enrollments
  UNION ALL
  SELECT cohort_id, student_id, valid_from, valid_to, revoked_at
  FROM programs_assignments
), bindings AS (
  SELECT e.id, min('cohort:' || m.cohort_id) AS evaluation_node_id
  FROM records_events AS e
  JOIN memberships AS m ON m.person_id = e.person_id
  JOIN programs_cohorts AS c ON c.id = m.cohort_id
  JOIN directory_people AS person ON person.id = e.person_id
  LEFT JOIN staffing_projects AS project ON project.id = e.project_id
  WHERE m.valid_from <= e.occurred_on
    AND (m.valid_to IS NULL OR e.occurred_on < m.valid_to)
    AND (m.revoked_at IS NULL OR e.occurred_on < m.revoked_at)
    AND (e.project_id IS NULL OR (
      project.id IS NOT NULL AND project.cohort_id IS NOT NULL
      AND project.cohort_id = m.cohort_id
    ))
  GROUP BY e.id HAVING count(DISTINCT m.cohort_id) = 1
)
UPDATE records_events AS e SET evaluation_node_id = bindings.evaluation_node_id
FROM bindings WHERE bindings.id = e.id AND e.evaluation_node_id IS NULL;
--> statement-breakpoint
-- Only the pinned mapper's weekly summary is a projection of that same event.
-- Standalone graduation/interview/unknown historical reviews stay unbound.
UPDATE records_historical_evaluations AS h
SET evaluation_node_id = e.evaluation_node_id
FROM records_events AS e, records_fragments AS f,
  records_original_versions AS v, records_originals AS original
WHERE h.source_record_id = e.id AND h.person_id = e.person_id
  AND h.occurred_on = e.occurred_on AND e.evaluation_node_id IS NOT NULL
  AND h.evaluation_node_id IS NULL AND h.kind = '训练营周评'
  AND h.rule_version_id = 'xe-weekly-v1' AND h.source_category = 'prototype_baseline'
  AND f.id = h.fragment_id AND f.original_version_id = h.original_version_id
  AND f.location->>'kind' = 'snapshot_field'
  AND f.location->>'fieldPath' = 'events[' || e.id || '].sum'
  AND v.id = h.original_version_id AND v.source_commit = '2e51b50'
  AND original.id = v.original_id AND original.kind = 'prototype_snapshot';
