CREATE TABLE "records_draft_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"person_id" text NOT NULL,
	"created_save_id" text NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "records_draft_person_event" UNIQUE("draft_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "records_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_account_id" text NOT NULL,
	"revision" integer NOT NULL,
	"rule_version_id" text NOT NULL,
	"draft" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	CONSTRAINT "records_draft_revision" CHECK ("records_drafts"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "records_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_account_id" text NOT NULL,
	"action" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"draft_id" text NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "records_operation_key" UNIQUE("actor_account_id","action","operation_id"),
	CONSTRAINT "records_operation_action" CHECK ("records_operations"."action" in ('save','undo'))
);
--> statement-breakpoint
CREATE TABLE "records_saves" (
	"id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"actor_account_id" text NOT NULL,
	"actor_person_id" text NOT NULL,
	"person_ids" jsonb NOT NULL,
	"project_id" text,
	"saved_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"confirmation_ids" jsonb NOT NULL,
	"review_ids" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "records_events" DROP CONSTRAINT "records_sbi";--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "save_id" text;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "confirmation_id" text;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "counterpart_confirmation_id" text;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "suggestion_id" text;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "records_draft_events" ADD CONSTRAINT "records_draft_events_event_id_records_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."records_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_draft_events" ADD CONSTRAINT "records_draft_events_draft_id_records_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."records_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_draft_events" ADD CONSTRAINT "records_draft_events_created_save_id_records_saves_id_fk" FOREIGN KEY ("created_save_id") REFERENCES "public"."records_saves"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_operations" ADD CONSTRAINT "records_operations_draft_id_records_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."records_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_saves" ADD CONSTRAINT "records_saves_draft_id_records_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."records_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_score_reviews_confirmation_id_talent_confirmations_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."talent_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_score_reviews_counterpart_confirmation_id_talent_confirmations_id_fk" FOREIGN KEY ("counterpart_confirmation_id") REFERENCES "public"."talent_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_score_reviews" ADD CONSTRAINT "talent_score_reviews_suggestion_id_talent_ai_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."talent_ai_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_events" ADD CONSTRAINT "records_sbi" CHECK ("records_events"."demo" or length(trim("records_events"."behavior")) > 0);