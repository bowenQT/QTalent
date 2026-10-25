CREATE TABLE "evaluation_anchors" (
	"id" text PRIMARY KEY NOT NULL,
	"dimension_id" text NOT NULL,
	"rule_version_id" text NOT NULL,
	"value" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "evaluation_anchor_match" UNIQUE("id","dimension_id","rule_version_id","value"),
	CONSTRAINT "evaluation_anchor_version_value" UNIQUE("dimension_id","rule_version_id","value"),
	CONSTRAINT "evaluation_anchor_value" CHECK ("evaluation_anchors"."value" between 1 and 5),
	CONSTRAINT "evaluation_anchor_text" CHECK (length(trim("evaluation_anchors"."text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "evaluation_dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"axis" text NOT NULL,
	"core" boolean NOT NULL,
	CONSTRAINT "evaluation_dimension_axis" CHECK ("evaluation_dimensions"."axis" in ('prof','pot'))
);
--> statement-breakpoint
CREATE TABLE "evaluation_rule_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"provenance" text NOT NULL,
	"source_commit" text,
	CONSTRAINT "evaluation_rule_provenance" CHECK ("evaluation_rule_versions"."provenance" in ('published','demo_import_snapshot')),
	CONSTRAINT "evaluation_demo_commit" CHECK ("evaluation_rule_versions"."provenance" <> 'demo_import_snapshot' or ("evaluation_rule_versions"."source_commit" is not null and length("evaluation_rule_versions"."source_commit") >= 7))
);
--> statement-breakpoint
CREATE TABLE "records_event_participants" (
	"event_id" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "records_event_participants_event_id_person_id_pk" PRIMARY KEY("event_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "records_event_sources" (
	"event_id" text NOT NULL,
	"fragment_id" text NOT NULL,
	"original_version_id" text NOT NULL,
	CONSTRAINT "records_event_sources_event_id_fragment_id_original_version_id_pk" PRIMARY KEY("event_id","fragment_id","original_version_id")
);
--> statement-breakpoint
CREATE TABLE "records_events" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"recorder_id" text NOT NULL,
	"project_id" text,
	"occurred_on" date NOT NULL,
	"title" text NOT NULL,
	"situation" text NOT NULL,
	"behavior" text NOT NULL,
	"impact" text NOT NULL,
	"rule_version_id" text NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "records_event_rule_version" UNIQUE("id","rule_version_id"),
	CONSTRAINT "records_sbi" CHECK (length(trim("records_events"."situation")) > 0 and ("records_events"."demo" or length(trim("records_events"."behavior")) > 0))
);
--> statement-breakpoint
CREATE TABLE "records_fragments" (
	"id" text PRIMARY KEY NOT NULL,
	"original_version_id" text NOT NULL,
	"location" jsonb NOT NULL,
	"excerpt" text NOT NULL,
	CONSTRAINT "records_fragment_version" UNIQUE("id","original_version_id"),
	CONSTRAINT "records_excerpt_nonblank" CHECK ("records_fragments"."excerpt" ~ '[^[:space:]]'),
	CONSTRAINT "records_location" CHECK (coalesce(jsonb_typeof("records_fragments"."location") = 'object' and case "records_fragments"."location"->>'kind'
 when 'document' then jsonb_typeof("records_fragments"."location"->'paragraph') = 'string' and length(trim("records_fragments"."location"->>'paragraph')) > 0 and (not ("records_fragments"."location" ? 'page') or (jsonb_typeof("records_fragments"."location"->'page') = 'number' and ("records_fragments"."location"->>'page')::numeric > 0 and ("records_fragments"."location"->>'page')::numeric = trunc(("records_fragments"."location"->>'page')::numeric)))
 when 'spreadsheet' then jsonb_typeof("records_fragments"."location"->'sheet') = 'string' and length(trim("records_fragments"."location"->>'sheet')) > 0 and jsonb_typeof("records_fragments"."location"->'cell') = 'string' and length(trim("records_fragments"."location"->>'cell')) > 0
 when 'snapshot_field' then jsonb_typeof("records_fragments"."location"->'fieldPath') = 'string' and length(trim("records_fragments"."location"->>'fieldPath')) > 0 and (not ("records_fragments"."location" ? 'originalLocation') or jsonb_typeof("records_fragments"."location"->'originalLocation') = 'string')
 when 'recording' then jsonb_typeof("records_fragments"."location"->'startMs') = 'number' and jsonb_typeof("records_fragments"."location"->'endMs') = 'number' and ("records_fragments"."location"->>'startMs')::numeric >= 0 and ("records_fragments"."location"->>'endMs')::numeric > ("records_fragments"."location"->>'startMs')::numeric and ("records_fragments"."location"->>'startMs')::numeric = trunc(("records_fragments"."location"->>'startMs')::numeric) and ("records_fragments"."location"->>'endMs')::numeric = trunc(("records_fragments"."location"->>'endMs')::numeric)
 else false end, false))
);
--> statement-breakpoint
CREATE TABLE "records_historical_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"source_record_id" text NOT NULL,
	"person_id" text,
	"recorder_id" text NOT NULL,
	"occurred_on" date NOT NULL,
	"kind" text NOT NULL,
	"period" text,
	"scale" jsonb NOT NULL,
	"rule_version_id" text,
	"original_version_id" text NOT NULL,
	"fragment_id" text NOT NULL,
	"source_category" text DEFAULT 'original' NOT NULL,
	CONSTRAINT "records_history_scale" CHECK (jsonb_typeof("records_historical_evaluations"."scale") = 'array'),
	CONSTRAINT "records_history_source_category" CHECK ("records_historical_evaluations"."source_category" in ('original','prototype_baseline'))
);
--> statement-breakpoint
CREATE TABLE "records_historical_participants" (
	"evaluation_id" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "records_historical_participants_evaluation_id_person_id_pk" PRIMARY KEY("evaluation_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "records_import_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"source_commit" text NOT NULL,
	"field_path" text NOT NULL,
	"provenance" text NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "records_snapshot_source" UNIQUE("source_commit","field_path"),
	CONSTRAINT "records_snapshot_provenance" CHECK ("records_import_snapshots"."provenance" = 'demo_import_snapshot')
);
--> statement-breakpoint
CREATE TABLE "records_original_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"original_id" text NOT NULL,
	"version" integer NOT NULL,
	"content_digest" text NOT NULL,
	"source_commit" text,
	"source_blob" text,
	"source_path" text,
	CONSTRAINT "records_original_version" UNIQUE("original_id","version"),
	CONSTRAINT "records_version_positive" CHECK ("records_original_versions"."version" > 0),
	CONSTRAINT "records_digest_nonempty" CHECK (length(trim("records_original_versions"."content_digest")) > 0)
);
--> statement-breakpoint
CREATE TABLE "records_originals" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'original' NOT NULL,
	"display_notice" text,
	CONSTRAINT "records_original_kind" CHECK ("records_originals"."kind" in ('original','prototype_snapshot'))
);
--> statement-breakpoint
CREATE TABLE "records_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"author_id" text,
	"model_version" text,
	"uncertainty" text,
	"fragment_id" text NOT NULL,
	"original_version_id" text NOT NULL,
	CONSTRAINT "records_statement_kind" CHECK ("records_statements"."kind" in ('original_fact','self_report','management_observation','ai_inference','human_conclusion')),
	CONSTRAINT "records_statement_attribution" CHECK (("records_statements"."kind" = 'ai_inference' and "records_statements"."author_id" is null and "records_statements"."model_version" is not null and length(trim("records_statements"."model_version")) > 0) or ("records_statements"."kind" <> 'ai_inference' and "records_statements"."author_id" is not null and "records_statements"."model_version" is null))
);
--> statement-breakpoint
CREATE TABLE "talent_ai_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"rule_version_id" text NOT NULL,
	"model_version" text NOT NULL,
	"source_category" text DEFAULT 'original' NOT NULL,
	"status" text NOT NULL,
	"value" integer,
	"anchor_id" text,
	"fragment_id" text NOT NULL,
	"original_version_id" text NOT NULL,
	"rationale" text NOT NULL,
	CONSTRAINT "talent_ai_identity" UNIQUE("id","event_id","dimension_id","rule_version_id"),
	CONSTRAINT "talent_ai_status_value" CHECK (("talent_ai_suggestions"."status" = 'scored' and "talent_ai_suggestions"."value" between 1 and 5 and "talent_ai_suggestions"."value" is not null and "talent_ai_suggestions"."anchor_id" is not null) or ("talent_ai_suggestions"."status" in ('unknown','not_demonstrated') and "talent_ai_suggestions"."value" is null and "talent_ai_suggestions"."anchor_id" is null)),
	CONSTRAINT "talent_ai_source_category" CHECK ("talent_ai_suggestions"."source_category" in ('original','prototype_baseline')),
	CONSTRAINT "talent_ai_model" CHECK (length(trim("talent_ai_suggestions"."model_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "talent_confirmations" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"evaluator_id" text,
	"source_category" text DEFAULT 'original' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"rule_version_id" text NOT NULL,
	"status" text NOT NULL,
	"value" integer,
	"anchor_id" text,
	"fragment_id" text NOT NULL,
	"original_version_id" text NOT NULL,
	"revision" integer NOT NULL,
	"active" boolean NOT NULL,
	"modified_by" text,
	"reason" text,
	"previous_id" text,
	"previous_revision" integer,
	"suggestion_id" text,
	CONSTRAINT "talent_confirmation_revision" UNIQUE("event_id","dimension_id","evaluator_id","revision"),
	CONSTRAINT "talent_confirmation_lineage" UNIQUE("id","event_id","dimension_id","evaluator_id","revision"),
	CONSTRAINT "talent_confirmation_provenance" CHECK (("talent_confirmations"."source_category" = 'original' and "talent_confirmations"."evaluator_id" is not null and "talent_confirmations"."modified_by" is not null) or ("talent_confirmations"."source_category" = 'prototype_baseline' and "talent_confirmations"."confirmed_at" is null and "talent_confirmations"."modified_by" is null and "talent_confirmations"."revision" = 1 and ("talent_confirmations"."status" <> 'scored' or "talent_confirmations"."evaluator_id" is not null))),
	CONSTRAINT "talent_confirmation_status_value" CHECK (("talent_confirmations"."status" = 'scored' and "talent_confirmations"."value" between 1 and 5 and "talent_confirmations"."value" is not null and "talent_confirmations"."anchor_id" is not null) or ("talent_confirmations"."status" in ('unknown','not_demonstrated') and "talent_confirmations"."value" is null and "talent_confirmations"."anchor_id" is null)),
	CONSTRAINT "talent_confirmation_revision_chain" CHECK (("talent_confirmations"."revision" = 1 and "talent_confirmations"."previous_id" is null and "talent_confirmations"."previous_revision" is null) or ("talent_confirmations"."revision" > 1 and "talent_confirmations"."previous_id" is not null and "talent_confirmations"."previous_revision" = "talent_confirmations"."revision" - 1 and "talent_confirmations"."previous_revision" is not null and length(trim("talent_confirmations"."reason")) > 0 and "talent_confirmations"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "talent_score_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	CONSTRAINT "talent_review_reason" CHECK ("talent_score_reviews"."reason" in ('score_gap','ai_changed_without_reason','post_freeze_position_change')),
	CONSTRAINT "talent_review_status" CHECK ("talent_score_reviews"."status" in ('open','resolved'))
);
--> statement-breakpoint
ALTER TABLE "evaluation_anchors" ADD CONSTRAINT "evaluation_anchors_dimension_id_evaluation_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."evaluation_dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_anchors" ADD CONSTRAINT "evaluation_anchors_rule_version_id_evaluation_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."evaluation_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_event_participants" ADD CONSTRAINT "records_event_participants_event_id_records_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."records_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_event_participants" ADD CONSTRAINT "records_event_participants_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_event_sources" ADD CONSTRAINT "records_event_sources_event_id_records_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."records_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_event_sources" ADD CONSTRAINT "records_event_sources_fragment_id_original_version_id_records_fragments_id_original_version_id_fk" FOREIGN KEY ("fragment_id","original_version_id") REFERENCES "public"."records_fragments"("id","original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_events" ADD CONSTRAINT "records_events_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_events" ADD CONSTRAINT "records_events_recorder_id_directory_people_id_fk" FOREIGN KEY ("recorder_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_events" ADD CONSTRAINT "records_events_project_id_staffing_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."staffing_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_events" ADD CONSTRAINT "records_events_rule_version_id_evaluation_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."evaluation_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_fragments" ADD CONSTRAINT "records_fragments_original_version_id_records_original_versions_id_fk" FOREIGN KEY ("original_version_id") REFERENCES "public"."records_original_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_historical_evaluations" ADD CONSTRAINT "records_historical_evaluations_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_historical_evaluations" ADD CONSTRAINT "records_historical_evaluations_recorder_id_directory_people_id_fk" FOREIGN KEY ("recorder_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_historical_evaluations" ADD CONSTRAINT "records_historical_evaluations_rule_version_id_evaluation_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."evaluation_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_historical_evaluations" ADD CONSTRAINT "records_historical_evaluations_fragment_id_original_version_id_records_fragments_id_original_version_id_fk" FOREIGN KEY ("fragment_id","original_version_id") REFERENCES "public"."records_fragments"("id","original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_historical_participants" ADD CONSTRAINT "records_historical_participants_evaluation_id_records_historical_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."records_historical_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_historical_participants" ADD CONSTRAINT "records_historical_participants_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_original_versions" ADD CONSTRAINT "records_original_versions_original_id_records_originals_id_fk" FOREIGN KEY ("original_id") REFERENCES "public"."records_originals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_statements" ADD CONSTRAINT "records_statements_event_id_records_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."records_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_statements" ADD CONSTRAINT "records_statements_author_id_directory_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_statements" ADD CONSTRAINT "records_statements_event_id_fragment_id_original_version_id_records_event_sources_event_id_fragment_id_original_version_id_fk" FOREIGN KEY ("event_id","fragment_id","original_version_id") REFERENCES "public"."records_event_sources"("event_id","fragment_id","original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_ai_suggestions" ADD CONSTRAINT "talent_ai_suggestions_dimension_id_evaluation_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."evaluation_dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_ai_suggestions" ADD CONSTRAINT "talent_ai_suggestions_event_id_rule_version_id_records_events_id_rule_version_id_fk" FOREIGN KEY ("event_id","rule_version_id") REFERENCES "public"."records_events"("id","rule_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_ai_suggestions" ADD CONSTRAINT "talent_ai_suggestions_anchor_id_dimension_id_rule_version_id_value_evaluation_anchors_id_dimension_id_rule_version_id_value_fk" FOREIGN KEY ("anchor_id","dimension_id","rule_version_id","value") REFERENCES "public"."evaluation_anchors"("id","dimension_id","rule_version_id","value") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_ai_suggestions" ADD CONSTRAINT "talent_ai_suggestions_event_id_fragment_id_original_version_id_records_event_sources_event_id_fragment_id_original_version_id_fk" FOREIGN KEY ("event_id","fragment_id","original_version_id") REFERENCES "public"."records_event_sources"("event_id","fragment_id","original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_confirmations" ADD CONSTRAINT "talent_confirmations_dimension_id_evaluation_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."evaluation_dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_confirmations" ADD CONSTRAINT "talent_confirmations_evaluator_id_directory_people_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_confirmations" ADD CONSTRAINT "talent_confirmations_modified_by_directory_people_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_confirmations" ADD CONSTRAINT "talent_confirmations_previous_id_talent_confirmations_id_fk" FOREIGN KEY ("previous_id") REFERENCES "public"."talent_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_confirmations" ADD CONSTRAINT "talent_confirmations_suggestion_id_event_id_dimension_id_rule_version_id_talent_ai_suggestions_id_event_id_dimension_id_rule_version_id_fk" FOREIGN KEY ("suggestion_id","event_id","dimension_id","rule_version_id") REFERENCES "public"."talent_ai_suggestions"("id","event_id","dimension_id","rule_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_confirmations" ADD CONSTRAINT "talent_confirmations_previous_id_event_id_dimension_id_evaluator_id_previous_revision_talent_confirmations_id_event_id_dimension_id_evaluator_id_revision_fk" FOREIGN KEY ("previous_id","event_id","dimension_id","evaluator_id","previous_revision") REFERENCES "public"."talent_confirmations"("id","event_id","dimension_id","evaluator_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_confirmations" ADD CONSTRAINT "talent_confirmations_event_id_rule_version_id_records_events_id_rule_version_id_fk" FOREIGN KEY ("event_id","rule_version_id") REFERENCES "public"."records_events"("id","rule_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_confirmations" ADD CONSTRAINT "talent_confirmations_anchor_id_dimension_id_rule_version_id_value_evaluation_anchors_id_dimension_id_rule_version_id_value_fk" FOREIGN KEY ("anchor_id","dimension_id","rule_version_id","value") REFERENCES "public"."evaluation_anchors"("id","dimension_id","rule_version_id","value") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_confirmations" ADD CONSTRAINT "talent_confirmations_event_id_fragment_id_original_version_id_records_event_sources_event_id_fragment_id_original_version_id_fk" FOREIGN KEY ("event_id","fragment_id","original_version_id") REFERENCES "public"."records_event_sources"("event_id","fragment_id","original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_score_reviews_event_id_records_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."records_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_score_reviews_dimension_id_evaluation_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."evaluation_dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "talent_one_active_unattributed_status" ON "talent_confirmations" USING btree ("event_id","dimension_id") WHERE "talent_confirmations"."active" and "talent_confirmations"."evaluator_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "talent_one_active_confirmation" ON "talent_confirmations" USING btree ("event_id","dimension_id","evaluator_id") WHERE "talent_confirmations"."active";