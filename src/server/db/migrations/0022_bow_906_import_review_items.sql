CREATE TABLE "records_interview_import_review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_id" text NOT NULL,
	"kind" text NOT NULL,
	"revision" integer NOT NULL,
	"state" text NOT NULL,
	"question" jsonb NOT NULL,
	"created_by_account_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"audit_id" text NOT NULL,
	CONSTRAINT "records_interview_import_review_item_kind" UNIQUE("batch_id","row_id","kind"),
	CONSTRAINT "records_interview_import_review_item" CHECK ("records_interview_import_review_items"."kind" in ('unknown_interview_candidate','unknown_interviewer') and "records_interview_import_review_items"."state" in ('pending','deferred','resolved') and "records_interview_import_review_items"."revision" > 0 and jsonb_typeof("records_interview_import_review_items"."question") = 'object' and ("records_interview_import_review_items"."question"->'itemId') is not distinct from to_jsonb("records_interview_import_review_items"."id") and ("records_interview_import_review_items"."question"->'kind') is not distinct from to_jsonb("records_interview_import_review_items"."kind") and ("records_interview_import_review_items"."question"->'batchId') is not distinct from to_jsonb("records_interview_import_review_items"."batch_id") and ("records_interview_import_review_items"."question"->'importRowId') is not distinct from to_jsonb("records_interview_import_review_items"."row_id"))
);
--> statement-breakpoint
ALTER TABLE "records_interview_import_rows" DROP CONSTRAINT "records_interview_import_row";--> statement-breakpoint
ALTER TABLE "records_interview_import_rows" ADD COLUMN "filled" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "records_interview_import_review_items" ADD CONSTRAINT "records_interview_import_review_items_created_by_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_review_items" ADD CONSTRAINT "records_interview_import_review_items_audit_id_audit_events_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_review_items" ADD CONSTRAINT "records_interview_import_review_item_row" FOREIGN KEY ("batch_id","row_id") REFERENCES "public"."records_interview_import_rows"("batch_id","row_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_rows" ADD CONSTRAINT "records_interview_import_row" CHECK ("records_interview_import_rows"."row_id" ~ '[^[:space:]]' and "records_interview_import_rows"."ordinal" > 0 and "records_interview_import_rows"."review_index" >= 0 and "records_interview_import_rows"."revision" > 0 and jsonb_typeof("records_interview_import_rows"."parsed") = 'object' and jsonb_typeof("records_interview_import_rows"."filled") = 'object');