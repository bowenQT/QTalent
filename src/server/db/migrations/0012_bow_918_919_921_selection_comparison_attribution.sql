CREATE TABLE "evaluation_comparison_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cohort_id" text NOT NULL,
	"mapping_version_id" text NOT NULL,
	"source_commit" text NOT NULL,
	"contract_sha" text NOT NULL,
	"fixture_version" text NOT NULL,
	"input_file_hashes" jsonb NOT NULL,
	"input_case_count" integer NOT NULL,
	"facts_digest" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"nature" text NOT NULL,
	CONSTRAINT "comparison_batch_identity" CHECK ("evaluation_comparison_batches"."id" ~ '[^[:space:]]' and "evaluation_comparison_batches"."name" ~ '[^[:space:]]' and "evaluation_comparison_batches"."fixture_version" ~ '[^[:space:]]' and "evaluation_comparison_batches"."source_commit" ~ '^[a-f0-9]{40}$' and "evaluation_comparison_batches"."contract_sha" ~ '^[a-f0-9]{40}$' and "evaluation_comparison_batches"."facts_digest" ~ '^[a-f0-9]{64}$' and "evaluation_comparison_batches"."input_case_count">0 and "evaluation_comparison_batches"."nature"='demo_rebuilt' and isfinite("evaluation_comparison_batches"."imported_at")),
	CONSTRAINT "comparison_batch_input_files" CHECK (coalesce(jsonb_typeof("evaluation_comparison_batches"."input_file_hashes")='object' and ("evaluation_comparison_batches"."input_file_hashes"-ARRAY['tests/fixtures/bow-923/seed-input.json', 'tests/fixtures/bow-923/mapping.json', 'tests/fixtures/bow-923/selection-standard.json', 'tests/fixtures/bow-923/manual-comparability-marks.json', 'tests/fixtures/bow-923/source-rows.json', 'tests/fixtures/bow-923/manifest.json', 'tests/fixtures/bow-923/作品评审表.xlsx', 'tests/fixtures/bow-923/结营评审表.xlsx']::text[])='{}'::jsonb and (jsonb_typeof("evaluation_comparison_batches"."input_file_hashes"->'tests/fixtures/bow-923/seed-input.json')='string' and "evaluation_comparison_batches"."input_file_hashes"->>'tests/fixtures/bow-923/seed-input.json' ~ '^[a-f0-9]{64}$') and (jsonb_typeof("evaluation_comparison_batches"."input_file_hashes"->'tests/fixtures/bow-923/mapping.json')='string' and "evaluation_comparison_batches"."input_file_hashes"->>'tests/fixtures/bow-923/mapping.json' ~ '^[a-f0-9]{64}$') and (jsonb_typeof("evaluation_comparison_batches"."input_file_hashes"->'tests/fixtures/bow-923/selection-standard.json')='string' and "evaluation_comparison_batches"."input_file_hashes"->>'tests/fixtures/bow-923/selection-standard.json' ~ '^[a-f0-9]{64}$') and (jsonb_typeof("evaluation_comparison_batches"."input_file_hashes"->'tests/fixtures/bow-923/manual-comparability-marks.json')='string' and "evaluation_comparison_batches"."input_file_hashes"->>'tests/fixtures/bow-923/manual-comparability-marks.json' ~ '^[a-f0-9]{64}$') and (jsonb_typeof("evaluation_comparison_batches"."input_file_hashes"->'tests/fixtures/bow-923/source-rows.json')='string' and "evaluation_comparison_batches"."input_file_hashes"->>'tests/fixtures/bow-923/source-rows.json' ~ '^[a-f0-9]{64}$') and (jsonb_typeof("evaluation_comparison_batches"."input_file_hashes"->'tests/fixtures/bow-923/manifest.json')='string' and "evaluation_comparison_batches"."input_file_hashes"->>'tests/fixtures/bow-923/manifest.json' ~ '^[a-f0-9]{64}$') and (jsonb_typeof("evaluation_comparison_batches"."input_file_hashes"->'tests/fixtures/bow-923/作品评审表.xlsx')='string' and "evaluation_comparison_batches"."input_file_hashes"->>'tests/fixtures/bow-923/作品评审表.xlsx' ~ '^[a-f0-9]{64}$') and (jsonb_typeof("evaluation_comparison_batches"."input_file_hashes"->'tests/fixtures/bow-923/结营评审表.xlsx')='string' and "evaluation_comparison_batches"."input_file_hashes"->>'tests/fixtures/bow-923/结营评审表.xlsx' ~ '^[a-f0-9]{64}$'),false))
);
--> statement-breakpoint
CREATE TABLE "evaluation_comparison_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"person_id" text NOT NULL,
	"judgment_id" text NOT NULL,
	"judgment_name" text NOT NULL,
	"front_node_id" text NOT NULL,
	"back_node_id" text NOT NULL,
	"work_kind" text NOT NULL,
	"work_id" text NOT NULL,
	"team_id" text,
	CONSTRAINT "comparison_case_batch_id" UNIQUE("batch_id","id"),
	CONSTRAINT "comparison_case_identity" CHECK ("evaluation_comparison_cases"."id" ~ '[^[:space:]]' and "evaluation_comparison_cases"."judgment_id" ~ '[^[:space:]]' and "evaluation_comparison_cases"."judgment_name" ~ '[^[:space:]]' and "evaluation_comparison_cases"."work_id" ~ '[^[:space:]]' and "evaluation_comparison_cases"."front_node_id"<>"evaluation_comparison_cases"."back_node_id"),
	CONSTRAINT "comparison_case_work" CHECK (coalesce(("evaluation_comparison_cases"."work_kind"='individual' and "evaluation_comparison_cases"."team_id" is null) or ("evaluation_comparison_cases"."work_kind"='team' and "evaluation_comparison_cases"."team_id" ~ '[^[:space:]]'),false))
);
--> statement-breakpoint
CREATE TABLE "evaluation_comparison_manual_marks" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"reason" text NOT NULL,
	"marked_by" text NOT NULL,
	"marked_at" text NOT NULL,
	"nature" text NOT NULL,
	"source_file_sha256" text NOT NULL,
	CONSTRAINT "evaluation_comparison_manual_marks_case_id_unique" UNIQUE("case_id"),
	CONSTRAINT "comparison_manual_mark_identity" CHECK ("evaluation_comparison_manual_marks"."id" ~ '[^[:space:]]' and "evaluation_comparison_manual_marks"."reason" ~ '[^[:space:]]' and "evaluation_comparison_manual_marks"."nature"='demo_human_mark' and "evaluation_comparison_manual_marks"."source_file_sha256" ~ '^[a-f0-9]{64}$' and "evaluation_comparison_manual_marks"."marked_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$' and isfinite("evaluation_comparison_manual_marks"."marked_at"::timestamptz))
);
--> statement-breakpoint
CREATE TABLE "evaluation_comparison_mappings" (
	"version_id" text PRIMARY KEY NOT NULL,
	"front_scale_id" text NOT NULL,
	"back_scale_id" text NOT NULL,
	"rows" jsonb NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" text NOT NULL,
	"source_commit" text NOT NULL,
	"source_file_sha256" text NOT NULL,
	"nature" text NOT NULL,
	CONSTRAINT "comparison_mapping_identity" CHECK ("evaluation_comparison_mappings"."version_id" ~ '^map-xe-select-v[1-9][0-9]*$' and "evaluation_comparison_mappings"."front_scale_id" ~ '[^[:space:]]' and "evaluation_comparison_mappings"."back_scale_id" ~ '[^[:space:]]' and "evaluation_comparison_mappings"."source_commit" ~ '^[a-f0-9]{40}$' and "evaluation_comparison_mappings"."source_file_sha256" ~ '^[a-f0-9]{64}$' and "evaluation_comparison_mappings"."nature"='demo_human_confirmation' and "evaluation_comparison_mappings"."confirmed_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$' and isfinite("evaluation_comparison_mappings"."confirmed_at"::timestamptz)),
	CONSTRAINT "comparison_mapping_rows" CHECK (coalesce(jsonb_typeof("evaluation_comparison_mappings"."rows")='array' and jsonb_array_length("evaluation_comparison_mappings"."rows")=3 and (jsonb_typeof("evaluation_comparison_mappings"."rows"->0)='object' and (("evaluation_comparison_mappings"."rows"->0)-ARRAY['frontGrade','frontPosition','backGrade'])='{}'::jsonb and jsonb_typeof(("evaluation_comparison_mappings"."rows"->0)->'frontGrade')='string' and ("evaluation_comparison_mappings"."rows"->0)->>'frontGrade' ~ '[^[:space:]]' and ("evaluation_comparison_mappings"."rows"->0)->>'frontPosition' in ('highest','middle','just_passed') and ("evaluation_comparison_mappings"."rows"->0)->>'backGrade' in ('不建议','继续观察','建议留用')) and (jsonb_typeof("evaluation_comparison_mappings"."rows"->1)='object' and (("evaluation_comparison_mappings"."rows"->1)-ARRAY['frontGrade','frontPosition','backGrade'])='{}'::jsonb and jsonb_typeof(("evaluation_comparison_mappings"."rows"->1)->'frontGrade')='string' and ("evaluation_comparison_mappings"."rows"->1)->>'frontGrade' ~ '[^[:space:]]' and ("evaluation_comparison_mappings"."rows"->1)->>'frontPosition' in ('highest','middle','just_passed') and ("evaluation_comparison_mappings"."rows"->1)->>'backGrade' in ('不建议','继续观察','建议留用')) and (jsonb_typeof("evaluation_comparison_mappings"."rows"->2)='object' and (("evaluation_comparison_mappings"."rows"->2)-ARRAY['frontGrade','frontPosition','backGrade'])='{}'::jsonb and jsonb_typeof(("evaluation_comparison_mappings"."rows"->2)->'frontGrade')='string' and ("evaluation_comparison_mappings"."rows"->2)->>'frontGrade' ~ '[^[:space:]]' and ("evaluation_comparison_mappings"."rows"->2)->>'frontPosition' in ('highest','middle','just_passed') and ("evaluation_comparison_mappings"."rows"->2)->>'backGrade' in ('不建议','继续观察','建议留用')) and ("evaluation_comparison_mappings"."rows"->0->>'frontGrade'<>"evaluation_comparison_mappings"."rows"->1->>'frontGrade' and "evaluation_comparison_mappings"."rows"->0->>'frontGrade'<>"evaluation_comparison_mappings"."rows"->2->>'frontGrade' and "evaluation_comparison_mappings"."rows"->1->>'frontGrade'<>"evaluation_comparison_mappings"."rows"->2->>'frontGrade') and ("evaluation_comparison_mappings"."rows"->0->>'frontPosition'<>"evaluation_comparison_mappings"."rows"->1->>'frontPosition' and "evaluation_comparison_mappings"."rows"->0->>'frontPosition'<>"evaluation_comparison_mappings"."rows"->2->>'frontPosition' and "evaluation_comparison_mappings"."rows"->1->>'frontPosition'<>"evaluation_comparison_mappings"."rows"->2->>'frontPosition') and ("evaluation_comparison_mappings"."rows"->0->>'backGrade'<>"evaluation_comparison_mappings"."rows"->1->>'backGrade' and "evaluation_comparison_mappings"."rows"->0->>'backGrade'<>"evaluation_comparison_mappings"."rows"->2->>'backGrade' and "evaluation_comparison_mappings"."rows"->1->>'backGrade'<>"evaluation_comparison_mappings"."rows"->2->>'backGrade'),false))
);
--> statement-breakpoint
CREATE TABLE "evaluation_comparison_stages" (
	"case_id" text NOT NULL,
	"side" text NOT NULL,
	"batch_id" text NOT NULL,
	"state" text NOT NULL,
	"missing_reason" text,
	"fragment_id" text,
	"original_version_id" text,
	"judgment_id" text,
	"source_standard_reference" text,
	"scale_id" text,
	"grade" text,
	"evaluator_id" text,
	"evaluated_at" text,
	"confirmation" text,
	CONSTRAINT "evaluation_comparison_stages_case_id_side_pk" PRIMARY KEY("case_id","side"),
	CONSTRAINT "comparison_stage_batch_judgment" UNIQUE("batch_id","judgment_id"),
	CONSTRAINT "comparison_stage_side" CHECK ("evaluation_comparison_stages"."side" in ('front','back')),
	CONSTRAINT "comparison_stage_source_pair" CHECK (("evaluation_comparison_stages"."fragment_id" is null)=("evaluation_comparison_stages"."original_version_id" is null)),
	CONSTRAINT "comparison_stage_state" CHECK (coalesce(
 ("evaluation_comparison_stages"."state"='present' and "evaluation_comparison_stages"."missing_reason" is null and "evaluation_comparison_stages"."fragment_id" is not null and "evaluation_comparison_stages"."original_version_id" is not null and "evaluation_comparison_stages"."judgment_id" ~ '[^[:space:]]' and "evaluation_comparison_stages"."source_standard_reference" ~ '[^[:space:]]' and "evaluation_comparison_stages"."scale_id" ~ '[^[:space:]]' and "evaluation_comparison_stages"."grade" ~ '[^[:space:]]' and "evaluation_comparison_stages"."evaluator_id" is not null and "evaluation_comparison_stages"."evaluated_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$' and isfinite("evaluation_comparison_stages"."evaluated_at"::timestamptz) and "evaluation_comparison_stages"."confirmation"='human_confirmed') or
 ("evaluation_comparison_stages"."state"='missing' and "evaluation_comparison_stages"."missing_reason" ~ '[^[:space:]]' and "evaluation_comparison_stages"."judgment_id" is null and "evaluation_comparison_stages"."source_standard_reference" is null and "evaluation_comparison_stages"."scale_id" is null and "evaluation_comparison_stages"."grade" is null and "evaluation_comparison_stages"."evaluator_id" is null and "evaluation_comparison_stages"."evaluated_at" is null and "evaluation_comparison_stages"."confirmation" is null),false))
);
--> statement-breakpoint
CREATE TABLE "evaluation_selection_category_head" (
	"category" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"current_period_id" text NOT NULL,
	"current_revision_id" text,
	"current_publication_id" text,
	"generation" integer NOT NULL,
	"next_version_ordinal" integer NOT NULL,
	CONSTRAINT "selection_head_category" CHECK ("evaluation_selection_category_head"."category" = 'xe_selection'),
	CONSTRAINT "selection_head_counters" CHECK ("evaluation_selection_category_head"."generation" > 0 and "evaluation_selection_category_head"."next_version_ordinal" > 0)
);
--> statement-breakpoint
CREATE TABLE "evaluation_selection_cohort_bindings" (
	"cohort_id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"binding" jsonb NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	CONSTRAINT "selection_binding_snapshot" CHECK (coalesce("evaluation_selection_cohort_bindings"."binding"->'cohort'->>'id' = "evaluation_selection_cohort_bindings"."cohort_id" and "evaluation_selection_cohort_bindings"."binding"->>'standardVersionId' = "evaluation_selection_cohort_bindings"."version_id", false) and isfinite("evaluation_selection_cohort_bindings"."bound_at"))
);
--> statement-breakpoint
CREATE TABLE "evaluation_selection_operations" (
	"actor_account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"actor_person_id" text NOT NULL,
	"action" text NOT NULL,
	"fingerprint" text NOT NULL,
	"scope_cohort_id" text NOT NULL,
	"visible_cohort_ids" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "evaluation_selection_operations_actor_account_id_operation_id_pk" PRIMARY KEY("actor_account_id","operation_id"),
	CONSTRAINT "selection_operation_fingerprint" CHECK ("evaluation_selection_operations"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "selection_operation_action" CHECK ("evaluation_selection_operations"."action" in ('create','save','submit','withdraw','return','publish','undo')),
	CONSTRAINT "selection_operation_result" CHECK (jsonb_typeof("evaluation_selection_operations"."result") = 'object' and jsonb_typeof("evaluation_selection_operations"."visible_cohort_ids") = 'array')
);
--> statement-breakpoint
CREATE TABLE "evaluation_selection_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"version_id" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"previous_version_id" text NOT NULL,
	"previous_effective" jsonb NOT NULL,
	"previous_publication_id" text,
	"previous_revision_snapshot" jsonb,
	"previous_superseded_revision" integer,
	"previous_period_id" text NOT NULL,
	"period_id" text NOT NULL,
	"previous_generation" integer NOT NULL,
	"undone_at" timestamp with time zone,
	"undo_period_id" text,
	"undo_generation" integer,
	CONSTRAINT "evaluation_selection_publications_period_id_unique" UNIQUE("period_id"),
	CONSTRAINT "evaluation_selection_publications_undo_period_id_unique" UNIQUE("undo_period_id"),
	CONSTRAINT "selection_publication_pair" CHECK (("evaluation_selection_publications"."previous_revision_snapshot" is null and "evaluation_selection_publications"."previous_superseded_revision" is null) or ("evaluation_selection_publications"."previous_revision_snapshot" is not null and "evaluation_selection_publications"."previous_superseded_revision" is not null and "evaluation_selection_publications"."previous_superseded_revision" > 0)),
	CONSTRAINT "selection_publication_generation" CHECK ("evaluation_selection_publications"."previous_generation" > 0),
	CONSTRAINT "selection_publication_undo" CHECK (("evaluation_selection_publications"."undone_at" is null and "evaluation_selection_publications"."undo_period_id" is null and "evaluation_selection_publications"."undo_generation" is null) or ("evaluation_selection_publications"."undone_at" is not null and isfinite("evaluation_selection_publications"."undone_at") and "evaluation_selection_publications"."undo_period_id" is not null and "evaluation_selection_publications"."undo_generation" is not null and "evaluation_selection_publications"."undo_generation" > "evaluation_selection_publications"."previous_generation"))
);
--> statement-breakpoint
CREATE TABLE "evaluation_selection_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"base_version_id" text NOT NULL,
	"scope_cohort_id" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer NOT NULL,
	"content_revision" integer NOT NULL,
	"content_was_published" boolean NOT NULL,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evaluation_selection_revisions_version_id_unique" UNIQUE("version_id"),
	CONSTRAINT "selection_revision_identity" UNIQUE("id","version_id"),
	CONSTRAINT "selection_revision_version" CHECK ("evaluation_selection_revisions"."version_id" ~ '^xe-select-v[1-9][0-9]*$' and "evaluation_selection_revisions"."version_id" <> "evaluation_selection_revisions"."base_version_id"),
	CONSTRAINT "selection_revision_state" CHECK ("evaluation_selection_revisions"."state" in ('draft','pending_confirmation','active','superseded')),
	CONSTRAINT "selection_revision_counter" CHECK ("evaluation_selection_revisions"."revision" > 0 and "evaluation_selection_revisions"."content_revision" > 0 and isfinite("evaluation_selection_revisions"."updated_at")),
	CONSTRAINT "selection_revision_snapshot" CHECK (coalesce(
    "evaluation_selection_revisions"."record"->'revision'->>'id' = "evaluation_selection_revisions"."id" and
    "evaluation_selection_revisions"."record"->'revision'->>'versionId' = "evaluation_selection_revisions"."version_id" and
    "evaluation_selection_revisions"."record"->'revision'->>'baseVersionId' = "evaluation_selection_revisions"."base_version_id" and
    "evaluation_selection_revisions"."record"->'revision'->>'state' = "evaluation_selection_revisions"."state" and
    ("evaluation_selection_revisions"."record"->'revision'->>'revision')::integer = "evaluation_selection_revisions"."revision" and
    ("evaluation_selection_revisions"."record"->'revision'->>'contentRevision')::integer = "evaluation_selection_revisions"."content_revision" and
    "evaluation_selection_revisions"."record"->>'scopeCohortId' = "evaluation_selection_revisions"."scope_cohort_id" and
    ("evaluation_selection_revisions"."record"->>'contentWasPublished')::boolean = "evaluation_selection_revisions"."content_was_published", false))
);
--> statement-breakpoint
CREATE TABLE "evaluation_selection_version_content" (
	"version_id" text PRIMARY KEY NOT NULL,
	"content" jsonb NOT NULL,
	"origin" text NOT NULL,
	"source_reference" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "selection_content_version" CHECK ("evaluation_selection_version_content"."version_id" ~ '^xe-select-v[1-9][0-9]*$'),
	CONSTRAINT "selection_content_origin" CHECK ("evaluation_selection_version_content"."origin" in ('baseline','publication')),
	CONSTRAINT "selection_content_shape" CHECK (jsonb_typeof("evaluation_selection_version_content"."content") = 'object' and length(trim("evaluation_selection_version_content"."source_reference")) > 0 and isfinite("evaluation_selection_version_content"."recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "evaluation_attribution_hypotheses" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "evaluation_hypothesis_batch" UNIQUE("id","batch_id"),
	CONSTRAINT "evaluation_hypothesis_identity" CHECK (coalesce(jsonb_typeof("evaluation_attribution_hypotheses"."payload")='object' and "evaluation_attribution_hypotheses"."payload"->>'id'="evaluation_attribution_hypotheses"."id" and "evaluation_attribution_hypotheses"."payload"->>'batchId'="evaluation_attribution_hypotheses"."batch_id" and "evaluation_attribution_hypotheses"."payload"->>'origin'='ai_hypothesis',false))
);
--> statement-breakpoint
CREATE TABLE "evaluation_attribution_operations" (
	"account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"actor_person_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"evidence_fingerprint" text NOT NULL,
	"reservation_id" text NOT NULL,
	"state" text NOT NULL,
	"result" jsonb,
	"model_request_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "evaluation_attribution_operations_account_id_operation_id_pk" PRIMARY KEY("account_id","operation_id"),
	CONSTRAINT "evaluation_attribution_operation_identity" CHECK (length(trim("evaluation_attribution_operations"."operation_id"))>0 and length(trim("evaluation_attribution_operations"."fingerprint"))>0 and length(trim("evaluation_attribution_operations"."evidence_fingerprint"))>0 and length(trim("evaluation_attribution_operations"."reservation_id"))>0),
	CONSTRAINT "evaluation_attribution_operation_state" CHECK (("evaluation_attribution_operations"."state"='pending' and "evaluation_attribution_operations"."result" is null and "evaluation_attribution_operations"."model_request_id" is null and "evaluation_attribution_operations"."finished_at" is null) or ("evaluation_attribution_operations"."state"='finished' and "evaluation_attribution_operations"."result" is not null and "evaluation_attribution_operations"."result"<>'null'::jsonb and "evaluation_attribution_operations"."finished_at" is not null and "evaluation_attribution_operations"."finished_at">="evaluation_attribution_operations"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "evaluation_selection_draft_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"attribution_id" text NOT NULL,
	"attribution_revision" integer NOT NULL,
	"base_version_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "evaluation_proposal_identity" CHECK (coalesce(jsonb_typeof("evaluation_selection_draft_proposals"."payload")='object' and "evaluation_selection_draft_proposals"."payload"->>'id'="evaluation_selection_draft_proposals"."id" and "evaluation_selection_draft_proposals"."payload"->>'attributionId'="evaluation_selection_draft_proposals"."attribution_id" and "evaluation_selection_draft_proposals"."payload"->>'baseVersionId'="evaluation_selection_draft_proposals"."base_version_id" and "evaluation_selection_draft_proposals"."payload"->'humanVersion'='null'::jsonb and "evaluation_selection_draft_proposals"."payload"->'aiDraft'->>'origin'='ai_draft' and "evaluation_selection_draft_proposals"."payload"->'aiDraft'->'basis'->>'id'="evaluation_selection_draft_proposals"."attribution_id" and "evaluation_selection_draft_proposals"."payload"->'aiDraft'->'basis'->'revision'=to_jsonb("evaluation_selection_draft_proposals"."attribution_revision"),false))
);
--> statement-breakpoint
CREATE TABLE "evaluation_standard_attributions" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"batch_id" text NOT NULL,
	"hypothesis_id" text,
	"confirmed_by_person_id" text NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "evaluation_attribution_revision" UNIQUE("id","revision"),
	CONSTRAINT "evaluation_attribution_revision_one" CHECK ("evaluation_standard_attributions"."revision"=1),
	CONSTRAINT "evaluation_attribution_identity" CHECK (coalesce(jsonb_typeof("evaluation_standard_attributions"."payload")='object' and "evaluation_standard_attributions"."payload"->>'id'="evaluation_standard_attributions"."id" and "evaluation_standard_attributions"."payload"->'revision'=to_jsonb("evaluation_standard_attributions"."revision") and "evaluation_standard_attributions"."payload"->>'batchId'="evaluation_standard_attributions"."batch_id" and "evaluation_standard_attributions"."payload"->>'origin'='human_conclusion' and ("evaluation_standard_attributions"."payload"->'hypothesisId') is not distinct from coalesce(to_jsonb("evaluation_standard_attributions"."hypothesis_id"),'null'::jsonb) and "evaluation_standard_attributions"."payload"->'confirmedBy'->>'id'="evaluation_standard_attributions"."confirmed_by_person_id" and ("evaluation_standard_attributions"."payload"->>'confirmedAt')::timestamptz="evaluation_standard_attributions"."confirmed_at",false))
);
--> statement-breakpoint
ALTER TABLE "evaluation_comparison_batches" ADD CONSTRAINT "evaluation_comparison_batches_cohort_id_programs_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."programs_cohorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_batches" ADD CONSTRAINT "evaluation_comparison_batches_mapping_version_id_evaluation_comparison_mappings_version_id_fk" FOREIGN KEY ("mapping_version_id") REFERENCES "public"."evaluation_comparison_mappings"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_batches" ADD CONSTRAINT "comparison_batch_selection_binding_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."evaluation_selection_cohort_bindings"("cohort_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_cases" ADD CONSTRAINT "evaluation_comparison_cases_batch_id_evaluation_comparison_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."evaluation_comparison_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_cases" ADD CONSTRAINT "evaluation_comparison_cases_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_cases" ADD CONSTRAINT "evaluation_comparison_cases_front_node_id_programs_evaluation_nodes_id_fk" FOREIGN KEY ("front_node_id") REFERENCES "public"."programs_evaluation_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_cases" ADD CONSTRAINT "evaluation_comparison_cases_back_node_id_programs_evaluation_nodes_id_fk" FOREIGN KEY ("back_node_id") REFERENCES "public"."programs_evaluation_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_cases" ADD CONSTRAINT "comparison_case_front_subject_fk" FOREIGN KEY ("front_node_id","person_id") REFERENCES "public"."programs_evaluation_node_subjects"("evaluation_node_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_cases" ADD CONSTRAINT "comparison_case_back_subject_fk" FOREIGN KEY ("back_node_id","person_id") REFERENCES "public"."programs_evaluation_node_subjects"("evaluation_node_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_manual_marks" ADD CONSTRAINT "evaluation_comparison_manual_marks_case_id_evaluation_comparison_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."evaluation_comparison_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_manual_marks" ADD CONSTRAINT "evaluation_comparison_manual_marks_marked_by_directory_people_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_mappings" ADD CONSTRAINT "evaluation_comparison_mappings_confirmed_by_directory_people_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_stages" ADD CONSTRAINT "evaluation_comparison_stages_evaluator_id_directory_people_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_stages" ADD CONSTRAINT "comparison_stage_case_fk" FOREIGN KEY ("batch_id","case_id") REFERENCES "public"."evaluation_comparison_cases"("batch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_comparison_stages" ADD CONSTRAINT "comparison_stage_source_fk" FOREIGN KEY ("fragment_id","original_version_id") REFERENCES "public"."records_fragments"("id","original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_category_head" ADD CONSTRAINT "evaluation_selection_category_head_version_id_evaluation_selection_version_content_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."evaluation_selection_version_content"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_category_head" ADD CONSTRAINT "evaluation_selection_category_head_current_period_id_evaluation_rule_version_applicability_period_id_fk" FOREIGN KEY ("current_period_id") REFERENCES "public"."evaluation_rule_version_applicability"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_category_head" ADD CONSTRAINT "evaluation_selection_category_head_current_revision_id_evaluation_selection_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."evaluation_selection_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_category_head" ADD CONSTRAINT "evaluation_selection_category_head_current_publication_id_evaluation_selection_publications_id_fk" FOREIGN KEY ("current_publication_id") REFERENCES "public"."evaluation_selection_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_cohort_bindings" ADD CONSTRAINT "evaluation_selection_cohort_bindings_cohort_id_programs_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."programs_cohorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_cohort_bindings" ADD CONSTRAINT "evaluation_selection_cohort_bindings_version_id_evaluation_selection_version_content_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."evaluation_selection_version_content"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_operations" ADD CONSTRAINT "evaluation_selection_operations_scope_cohort_id_programs_cohorts_id_fk" FOREIGN KEY ("scope_cohort_id") REFERENCES "public"."programs_cohorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_publications" ADD CONSTRAINT "evaluation_selection_publications_draft_id_evaluation_selection_revisions_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."evaluation_selection_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_publications" ADD CONSTRAINT "evaluation_selection_publications_version_id_evaluation_selection_version_content_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."evaluation_selection_version_content"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_publications" ADD CONSTRAINT "evaluation_selection_publications_previous_version_id_evaluation_selection_version_content_version_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES "public"."evaluation_selection_version_content"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_publications" ADD CONSTRAINT "evaluation_selection_publications_previous_publication_id_evaluation_selection_publications_id_fk" FOREIGN KEY ("previous_publication_id") REFERENCES "public"."evaluation_selection_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_publications" ADD CONSTRAINT "evaluation_selection_publications_previous_period_id_evaluation_rule_version_applicability_period_id_fk" FOREIGN KEY ("previous_period_id") REFERENCES "public"."evaluation_rule_version_applicability"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_publications" ADD CONSTRAINT "evaluation_selection_publications_period_id_evaluation_rule_version_applicability_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."evaluation_rule_version_applicability"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_publications" ADD CONSTRAINT "evaluation_selection_publications_undo_period_id_evaluation_rule_version_applicability_period_id_fk" FOREIGN KEY ("undo_period_id") REFERENCES "public"."evaluation_rule_version_applicability"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_revisions" ADD CONSTRAINT "evaluation_selection_revisions_base_version_id_evaluation_selection_version_content_version_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."evaluation_selection_version_content"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_revisions" ADD CONSTRAINT "evaluation_selection_revisions_scope_cohort_id_programs_cohorts_id_fk" FOREIGN KEY ("scope_cohort_id") REFERENCES "public"."programs_cohorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_version_content" ADD CONSTRAINT "evaluation_selection_version_content_version_id_evaluation_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."evaluation_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_attribution_operations" ADD CONSTRAINT "evaluation_attribution_operations_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_attribution_operations" ADD CONSTRAINT "evaluation_attribution_operations_actor_person_id_directory_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_draft_proposals" ADD CONSTRAINT "evaluation_selection_draft_proposals_base_version_id_evaluation_rule_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."evaluation_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_selection_draft_proposals" ADD CONSTRAINT "evaluation_proposal_attribution_revision_fk" FOREIGN KEY ("attribution_id","attribution_revision") REFERENCES "public"."evaluation_standard_attributions"("id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_standard_attributions" ADD CONSTRAINT "evaluation_standard_attributions_confirmed_by_person_id_directory_people_id_fk" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_standard_attributions" ADD CONSTRAINT "evaluation_attribution_hypothesis_batch_fk" FOREIGN KEY ("hypothesis_id","batch_id") REFERENCES "public"."evaluation_attribution_hypotheses"("id","batch_id") ON DELETE no action ON UPDATE no action;