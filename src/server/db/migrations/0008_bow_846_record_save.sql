CREATE TABLE "records_draft_batches" (
	"batch_id" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"duplicate_candidates" jsonb NOT NULL,
	"original_input" jsonb NOT NULL,
	"occurred_on" date NOT NULL,
	"model_version" text NOT NULL,
	"created_by_account_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "records_draft_batch_revision_positive" CHECK ("records_draft_batches"."revision" > 0),
	CONSTRAINT "records_draft_batch_model_required" CHECK (length(trim("records_draft_batches"."model_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "records_draft_events" (
	"batch_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"person_id" text NOT NULL,
	"event_id" text NOT NULL,
	CONSTRAINT "records_draft_events_batch_id_draft_id_person_id_pk" PRIMARY KEY("batch_id","draft_id","person_id"),
	CONSTRAINT "records_draft_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "records_drafts" (
	"draft_id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"revision" integer NOT NULL,
	"draft" jsonb NOT NULL,
	CONSTRAINT "records_draft_revision_positive" CHECK ("records_drafts"."revision" > 0),
	CONSTRAINT "records_draft_snapshot_identity" CHECK (jsonb_typeof("records_drafts"."draft") = 'object' and ("records_drafts"."draft"->'batchId') is not distinct from to_jsonb("records_drafts"."batch_id") and ("records_drafts"."draft"->'draftId') is not distinct from to_jsonb("records_drafts"."draft_id") and ("records_drafts"."draft"->'revision') is not distinct from to_jsonb("records_drafts"."revision"))
);
--> statement-breakpoint
CREATE TABLE "records_operations" (
	"actor_account_id" text NOT NULL,
	"action" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"save_id" text NOT NULL,
	"draft_snapshot" jsonb NOT NULL,
	"receipt" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "records_operations_actor_account_id_action_operation_id_pk" PRIMARY KEY("actor_account_id","action","operation_id"),
	CONSTRAINT "records_operation_action" CHECK ("records_operations"."action" in ('save','undo')),
	CONSTRAINT "records_operation_fingerprint" CHECK ("records_operations"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "records_saves" (
	"save_id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"actor_account_id" text NOT NULL,
	"actor_person_id" text NOT NULL,
	"draft_snapshot" jsonb NOT NULL,
	"input" jsonb NOT NULL,
	"original_input" jsonb NOT NULL,
	"receipt" jsonb NOT NULL,
	"confirmation_work" jsonb NOT NULL,
	"created_event_ids" jsonb NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "records_events" DROP CONSTRAINT "records_sbi";--> statement-breakpoint
ALTER TABLE "records_events" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "save_id" text;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "confirmation_id" text;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "counterpart_confirmation_id" text;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "records_draft_batches" ADD CONSTRAINT "records_draft_batches_created_by_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_draft_events" ADD CONSTRAINT "records_draft_events_batch_id_records_draft_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."records_draft_batches"("batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_draft_events" ADD CONSTRAINT "records_draft_events_draft_id_records_drafts_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."records_drafts"("draft_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_draft_events" ADD CONSTRAINT "records_draft_events_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_draft_events" ADD CONSTRAINT "records_draft_events_event_id_records_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."records_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_drafts" ADD CONSTRAINT "records_drafts_batch_id_records_draft_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."records_draft_batches"("batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_operations" ADD CONSTRAINT "records_operations_actor_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_operations" ADD CONSTRAINT "records_operations_save_id_records_saves_save_id_fk" FOREIGN KEY ("save_id") REFERENCES "public"."records_saves"("save_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_saves" ADD CONSTRAINT "records_saves_batch_id_records_draft_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."records_draft_batches"("batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_saves" ADD CONSTRAINT "records_saves_draft_id_records_drafts_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."records_drafts"("draft_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_saves" ADD CONSTRAINT "records_saves_actor_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_saves" ADD CONSTRAINT "records_saves_actor_person_id_directory_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_score_reviews_save_id_records_saves_save_id_fk" FOREIGN KEY ("save_id") REFERENCES "public"."records_saves"("save_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_score_reviews_confirmation_id_talent_confirmations_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."talent_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_score_reviews_counterpart_confirmation_id_talent_confirmations_id_fk" FOREIGN KEY ("counterpart_confirmation_id") REFERENCES "public"."talent_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "talent_review_ai_confirmation" ON "talent_score_reviews" USING btree ("reason","confirmation_id") WHERE "talent_score_reviews"."reason" = 'ai_changed_without_reason' and "talent_score_reviews"."confirmation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "talent_review_rater_pair" ON "talent_score_reviews" USING btree ("reason",least("confirmation_id", "counterpart_confirmation_id"),greatest("confirmation_id", "counterpart_confirmation_id")) WHERE "talent_score_reviews"."reason" = 'score_gap' and "talent_score_reviews"."confirmation_id" is not null and "talent_score_reviews"."counterpart_confirmation_id" is not null;--> statement-breakpoint
ALTER TABLE "records_events" ADD CONSTRAINT "records_sbi" CHECK ("records_events"."demo" or length(trim("records_events"."behavior")) > 0);--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_review_save_provenance" CHECK ("talent_score_reviews"."save_id" is null or ("talent_score_reviews"."confirmation_id" is not null and ("talent_score_reviews"."reason" <> 'score_gap' or "talent_score_reviews"."counterpart_confirmation_id" is not null)));--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_review_distinct_confirmations" CHECK ("talent_score_reviews"."counterpart_confirmation_id" is null or ("talent_score_reviews"."confirmation_id" is not null and "talent_score_reviews"."confirmation_id" <> "talent_score_reviews"."counterpart_confirmation_id"));