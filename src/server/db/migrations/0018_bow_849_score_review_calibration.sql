CREATE TABLE "talent_score_review_calibrations" (
	"item_id" text PRIMARY KEY NOT NULL,
	"original_revision" integer NOT NULL,
	"revision" integer NOT NULL,
	"event_id" text NOT NULL,
	"person_id" text NOT NULL,
	"evaluation_node_id" text NOT NULL,
	"dimension_id" text NOT NULL,
	"rule_version_id" text NOT NULL,
	"actor_account_id" text NOT NULL,
	"actor_person_id" text NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"value" integer NOT NULL,
	"anchor_id" text NOT NULL,
	"confirmation_id" text NOT NULL,
	"counterpart_confirmation_id" text,
	"suggestion_id" text,
	"original_fingerprint" text NOT NULL,
	"scope_fingerprint" text NOT NULL,
	"source_fact_revision" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "talent_review_calibration_receipt_identity" UNIQUE("item_id","revision","actor_account_id","actor_person_id"),
	CONSTRAINT "talent_review_calibration_revision" CHECK ("talent_score_review_calibrations"."original_revision" > 0 and "talent_score_review_calibrations"."revision" > 0 and "talent_score_review_calibrations"."revision" = "talent_score_review_calibrations"."original_revision" + 1),
	CONSTRAINT "talent_review_calibration_value" CHECK ("talent_score_review_calibrations"."value" between 1 and 5),
	CONSTRAINT "talent_review_calibration_fingerprints" CHECK ("talent_score_review_calibrations"."original_fingerprint" ~ '^[a-f0-9]{64}$' and "talent_score_review_calibrations"."scope_fingerprint" ~ '^[a-f0-9]{64}$' and "talent_score_review_calibrations"."source_fact_revision" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "talent_review_calibration_payload_identity" CHECK (jsonb_typeof("talent_score_review_calibrations"."payload") = 'object'
        and ("talent_score_review_calibrations"."payload" -> 'itemId') is not distinct from to_jsonb("talent_score_review_calibrations"."item_id")
        and ("talent_score_review_calibrations"."payload" -> 'revision') is not distinct from to_jsonb("talent_score_review_calibrations"."revision")
        and ("talent_score_review_calibrations"."payload" #> '{original,id}') is not distinct from to_jsonb("talent_score_review_calibrations"."item_id")
        and ("talent_score_review_calibrations"."payload" #> '{original,revision}') is not distinct from to_jsonb("talent_score_review_calibrations"."original_revision")
        and ("talent_score_review_calibrations"."payload" #> '{original,eventId}') is not distinct from to_jsonb("talent_score_review_calibrations"."event_id")
        and ("talent_score_review_calibrations"."payload" #> '{original,personId}') is not distinct from to_jsonb("talent_score_review_calibrations"."person_id")
        and ("talent_score_review_calibrations"."payload" #> '{original,dimensionId}') is not distinct from to_jsonb("talent_score_review_calibrations"."dimension_id")),
	CONSTRAINT "talent_review_calibration_payload_score" CHECK (("talent_score_review_calibrations"."payload" #> '{score,raterId}') is not distinct from to_jsonb("talent_score_review_calibrations"."actor_person_id")
        and ("talent_score_review_calibrations"."payload" #> '{score,value}') is not distinct from to_jsonb("talent_score_review_calibrations"."value")
        and ("talent_score_review_calibrations"."payload" #> '{score,anchor,id}') is not distinct from to_jsonb("talent_score_review_calibrations"."anchor_id")
        and ("talent_score_review_calibrations"."payload" #> '{score,anchor,ruleVersion}') is not distinct from to_jsonb("talent_score_review_calibrations"."rule_version_id")
        and jsonb_typeof("talent_score_review_calibrations"."payload" #> '{score,confirmedAt}') is not distinct from 'string'
        and ("talent_score_review_calibrations"."payload" #>> '{score,confirmedAt}')::timestamptz is not distinct from "talent_score_review_calibrations"."confirmed_at"
        and jsonb_typeof("talent_score_review_calibrations"."payload" #> '{score,reason}') is not distinct from 'string'
        and coalesce(("talent_score_review_calibrations"."payload" #>> '{score,reason}') ~ '[^[:space:]]', false)),
	CONSTRAINT "talent_review_calibration_original_kind" CHECK (coalesce((("talent_score_review_calibrations"."payload" #> '{original,kind}') = '"rater_gap"'::jsonb and "talent_score_review_calibrations"."counterpart_confirmation_id" is not null)
        or (("talent_score_review_calibrations"."payload" #> '{original,kind}') = '"ai_gap"'::jsonb and "talent_score_review_calibrations"."suggestion_id" is not null), false))
);
--> statement-breakpoint
CREATE TABLE "talent_score_review_operations" (
	"actor_account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"actor_person_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"scope_fingerprint" text NOT NULL,
	"item_id" text NOT NULL,
	"calibration_revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "talent_score_review_operations_actor_account_id_operation_id_pk" PRIMARY KEY("actor_account_id","operation_id"),
	CONSTRAINT "talent_review_operation_fingerprints" CHECK ("talent_score_review_operations"."fingerprint" ~ '^[a-f0-9]{64}$' and "talent_score_review_operations"."scope_fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_item_id_talent_score_reviews_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."talent_score_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_event_id_records_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."records_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_evaluation_node_id_programs_evaluation_nodes_id_fk" FOREIGN KEY ("evaluation_node_id") REFERENCES "public"."programs_evaluation_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_dimension_id_evaluation_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."evaluation_dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_actor_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_actor_person_id_directory_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_confirmation_id_talent_confirmations_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."talent_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_counterpart_confirmation_id_talent_confirmations_id_fk" FOREIGN KEY ("counterpart_confirmation_id") REFERENCES "public"."talent_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_suggestion_id_talent_ai_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."talent_ai_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_event_id_rule_version_id_records_events_id_rule_version_id_fk" FOREIGN KEY ("event_id","rule_version_id") REFERENCES "public"."records_events"("id","rule_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_calibrations" ADD CONSTRAINT "talent_score_review_calibrations_anchor_id_dimension_id_rule_version_id_value_evaluation_anchors_id_dimension_id_rule_version_id_value_fk" FOREIGN KEY ("anchor_id","dimension_id","rule_version_id","value") REFERENCES "public"."evaluation_anchors"("id","dimension_id","rule_version_id","value") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_review_operations" ADD CONSTRAINT "talent_review_operation_calibration_fk" FOREIGN KEY ("item_id","calibration_revision","actor_account_id","actor_person_id") REFERENCES "public"."talent_score_review_calibrations"("item_id","revision","actor_account_id","actor_person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_review_revision_positive" CHECK ("talent_score_reviews"."revision" > 0);