CREATE TABLE "records_interview_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_node_id" text NOT NULL,
	"file_name" text NOT NULL,
	"page_count" integer NOT NULL,
	"uploaded_by_person_id" text,
	"uploaded_at" timestamp with time zone NOT NULL,
	"demo" boolean NOT NULL,
	CONSTRAINT "records_interview_import_batch" CHECK ("records_interview_import_batches"."id" ~ '[^[:space:]]' and "records_interview_import_batches"."file_name" ~ '[^[:space:]]' and "records_interview_import_batches"."page_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "records_interview_import_candidates" (
	"batch_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"name" text NOT NULL,
	"person_id" text,
	"position_code" text,
	"interview_time" text,
	"status" text NOT NULL,
	"demo" boolean NOT NULL,
	CONSTRAINT "records_interview_import_candidates_batch_id_candidate_id_pk" PRIMARY KEY("batch_id","candidate_id"),
	CONSTRAINT "records_interview_import_candidate" CHECK ("records_interview_import_candidates"."candidate_id" ~ '[^[:space:]]' and "records_interview_import_candidates"."name" ~ '[^[:space:]]' and "records_interview_import_candidates"."status" in ('hired','rejected','offer_pending','offer_declined') and ("records_interview_import_candidates"."position_code" is null or "records_interview_import_candidates"."position_code" ~ '[^[:space:]]') and ("records_interview_import_candidates"."interview_time" is null or "records_interview_import_candidates"."interview_time" ~ '[^[:space:]]'))
);
--> statement-breakpoint
CREATE TABLE "records_interview_import_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_account_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"from_revision" integer NOT NULL,
	"to_revision" integer NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"audit_id" text NOT NULL,
	CONSTRAINT "records_interview_import_operation_revision" UNIQUE("batch_id","row_id","to_revision"),
	CONSTRAINT "records_interview_import_operation_audit" UNIQUE("audit_id"),
	CONSTRAINT "records_interview_import_operation" CHECK (coalesce("records_interview_import_operations"."id" ~ '[^[:space:]]' and "records_interview_import_operations"."action" in ('confirm','revert','fill','send_to_review') and "records_interview_import_operations"."from_revision" > 0 and "records_interview_import_operations"."to_revision" = "records_interview_import_operations"."from_revision" + 1 and jsonb_typeof("records_interview_import_operations"."before") = 'object' and jsonb_typeof("records_interview_import_operations"."after") = 'object', false))
);
--> statement-breakpoint
CREATE TABLE "records_interview_import_rows" (
	"batch_id" text NOT NULL,
	"row_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"material_id" text NOT NULL,
	"original_version_id" text NOT NULL,
	"parse_version_id" text NOT NULL,
	"fragment_id" text NOT NULL,
	"review_index" integer NOT NULL,
	"parsed" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"confirmed_candidate_id" text,
	"confirmed_for_revision" integer,
	"confirmed_by_account_id" text,
	"confirmed_at" timestamp with time zone,
	"decision" jsonb,
	"decision_revision" integer,
	CONSTRAINT "records_interview_import_rows_batch_id_row_id_pk" PRIMARY KEY("batch_id","row_id"),
	CONSTRAINT "records_interview_import_row_ordinal" UNIQUE("batch_id","ordinal"),
	CONSTRAINT "records_interview_import_row" CHECK ("records_interview_import_rows"."row_id" ~ '[^[:space:]]' and "records_interview_import_rows"."ordinal" > 0 and "records_interview_import_rows"."review_index" >= 0 and "records_interview_import_rows"."revision" > 0 and jsonb_typeof("records_interview_import_rows"."parsed") = 'object'),
	CONSTRAINT "records_interview_import_row_confirmation" CHECK (("records_interview_import_rows"."confirmed_candidate_id" is null and "records_interview_import_rows"."confirmed_for_revision" is null and "records_interview_import_rows"."confirmed_by_account_id" is null and "records_interview_import_rows"."confirmed_at" is null) or ("records_interview_import_rows"."confirmed_candidate_id" is not null and "records_interview_import_rows"."confirmed_for_revision" is not null and "records_interview_import_rows"."confirmed_by_account_id" is not null and "records_interview_import_rows"."confirmed_at" is not null and "records_interview_import_rows"."confirmed_for_revision" <= "records_interview_import_rows"."revision")),
	CONSTRAINT "records_interview_import_row_decision" CHECK (coalesce(("records_interview_import_rows"."decision" is null and "records_interview_import_rows"."decision_revision" is null) or (jsonb_typeof("records_interview_import_rows"."decision") = 'object' and "records_interview_import_rows"."decision" ? 'status' and "records_interview_import_rows"."decision_revision" is not null and "records_interview_import_rows"."decision_revision" <= "records_interview_import_rows"."revision"), false))
);
--> statement-breakpoint
ALTER TABLE "records_interview_import_batches" ADD CONSTRAINT "records_interview_import_batches_evaluation_node_id_programs_evaluation_nodes_id_fk" FOREIGN KEY ("evaluation_node_id") REFERENCES "public"."programs_evaluation_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_batches" ADD CONSTRAINT "records_interview_import_batches_uploaded_by_person_id_directory_people_id_fk" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_candidates" ADD CONSTRAINT "records_interview_import_candidates_batch_id_records_interview_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."records_interview_import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_candidates" ADD CONSTRAINT "records_interview_import_candidates_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_operations" ADD CONSTRAINT "records_interview_import_operations_actor_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_operations" ADD CONSTRAINT "records_interview_import_operations_audit_id_audit_events_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_operations" ADD CONSTRAINT "records_interview_import_operation_row" FOREIGN KEY ("batch_id","row_id") REFERENCES "public"."records_interview_import_rows"("batch_id","row_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_rows" ADD CONSTRAINT "records_interview_import_rows_batch_id_records_interview_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."records_interview_import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_rows" ADD CONSTRAINT "records_interview_import_rows_material_id_records_originals_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."records_originals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_rows" ADD CONSTRAINT "records_interview_import_rows_original_version_id_records_original_versions_id_fk" FOREIGN KEY ("original_version_id") REFERENCES "public"."records_original_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_rows" ADD CONSTRAINT "records_interview_import_rows_confirmed_by_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("confirmed_by_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_rows" ADD CONSTRAINT "records_interview_import_row_parse" FOREIGN KEY ("parse_version_id","original_version_id") REFERENCES "public"."records_material_parses"("id","original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_rows" ADD CONSTRAINT "records_interview_import_row_fragment" FOREIGN KEY ("fragment_id","original_version_id") REFERENCES "public"."records_fragments"("id","original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_rows" ADD CONSTRAINT "records_interview_import_row_candidate" FOREIGN KEY ("batch_id","confirmed_candidate_id") REFERENCES "public"."records_interview_import_candidates"("batch_id","candidate_id") ON DELETE no action ON UPDATE no action;