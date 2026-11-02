CREATE TABLE "records_media_materials" (
	"id" text PRIMARY KEY NOT NULL,
	"input_id" text NOT NULL,
	"input_version" text NOT NULL,
	"client_file_id" text NOT NULL,
	"upload_id" text NOT NULL,
	"record_collection_id" text NOT NULL,
	"original_version_id" text NOT NULL,
	"revision" integer NOT NULL,
	"intake_scope" jsonb,
	"scope_audit_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "records_media_material_client" UNIQUE("input_id","client_file_id"),
	CONSTRAINT "records_media_material_upload" UNIQUE("input_id","upload_id"),
	CONSTRAINT "records_media_material_revision" CHECK ("records_media_materials"."revision" > 0),
	CONSTRAINT "records_media_material_scope" CHECK (("records_media_materials"."intake_scope" is null and "records_media_materials"."scope_audit_id" is null) or ("records_media_materials"."intake_scope" is not null and "records_media_materials"."scope_audit_id" is not null and coalesce(jsonb_typeof("records_media_materials"."intake_scope") = 'object' and jsonb_typeof("records_media_materials"."intake_scope"->'subjects') = 'array' and jsonb_array_length("records_media_materials"."intake_scope"->'subjects') > 0 and jsonb_typeof("records_media_materials"."intake_scope"->'requiredKinds') = 'array' and jsonb_typeof("records_media_materials"."intake_scope"->'kind') = 'string' and ("records_media_materials"."intake_scope"->>'occurredOn') ~ '^\d{4}-\d{2}-\d{2}$', false)))
);
--> statement-breakpoint
CREATE TABLE "records_media_review_draft_dependencies" (
	"operation_id" text NOT NULL,
	"item_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"draft_revision" integer NOT NULL,
	CONSTRAINT "records_media_review_draft_dependencies_operation_id_item_id_draft_id_draft_revision_pk" PRIMARY KEY("operation_id","item_id","draft_id","draft_revision"),
	CONSTRAINT "records_media_review_draft_revision" CHECK ("records_media_review_draft_dependencies"."draft_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "records_media_review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"material_id" text NOT NULL,
	"kind" text NOT NULL,
	"revision" integer NOT NULL,
	"state" text NOT NULL,
	"question" jsonb NOT NULL,
	"current_operation_id" text,
	CONSTRAINT "records_media_item_material" UNIQUE("id","material_id"),
	CONSTRAINT "records_media_item_revision" CHECK ("records_media_review_items"."revision" > 0),
	CONSTRAINT "records_media_item_kind" CHECK ("records_media_review_items"."kind" in ('speaker','unknown_person','image_scope','unknown_interviewer','unknown_project','unknown_interview_candidate')),
	CONSTRAINT "records_media_item_state" CHECK ("records_media_review_items"."state" in ('pending','deferred','resolved') and ("records_media_review_items"."state" <> 'resolved' or "records_media_review_items"."current_operation_id" is not null)),
	CONSTRAINT "records_media_item_question" CHECK (jsonb_typeof("records_media_review_items"."question") = 'object' and ("records_media_review_items"."question"->'itemId') is not distinct from to_jsonb("records_media_review_items"."id") and ("records_media_review_items"."question"->'materialId') is not distinct from to_jsonb("records_media_review_items"."material_id") and ("records_media_review_items"."question"->'kind') is not distinct from to_jsonb("records_media_review_items"."kind"))
);
--> statement-breakpoint
CREATE TABLE "records_media_review_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_account_id" text NOT NULL,
	"actor_person_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"item_id" text NOT NULL,
	"material_id" text NOT NULL,
	"action" text NOT NULL,
	"source_operation_id" text,
	"command" jsonb NOT NULL,
	"receipt" jsonb NOT NULL,
	"changes" jsonb NOT NULL,
	"audit_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "records_media_review_operation_key" UNIQUE("actor_account_id","operation_id"),
	CONSTRAINT "records_media_review_operation_material" UNIQUE("id","material_id"),
	CONSTRAINT "records_media_review_operation_fingerprint" CHECK ("records_media_review_operations"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "records_media_review_operation_action" CHECK (("records_media_review_operations"."action" = 'resolve' and "records_media_review_operations"."source_operation_id" is null) or ("records_media_review_operations"."action" = 'undo' and "records_media_review_operations"."source_operation_id" is not null and "records_media_review_operations"."source_operation_id" <> "records_media_review_operations"."id")),
	CONSTRAINT "records_media_review_operation_command" CHECK (jsonb_typeof("records_media_review_operations"."command") = 'object' and ("records_media_review_operations"."command"->'operationId') is not distinct from to_jsonb("records_media_review_operations"."operation_id") and ("records_media_review_operations"."command"->'itemId') is not distinct from to_jsonb("records_media_review_operations"."item_id")),
	CONSTRAINT "records_media_review_operation_changes" CHECK (coalesce(jsonb_typeof("records_media_review_operations"."changes") = 'array' and jsonb_array_length("records_media_review_operations"."changes") > 0, false))
);
--> statement-breakpoint
ALTER TABLE "records_arrange_inputs" DROP CONSTRAINT "records_arrange_original_input";--> statement-breakpoint
ALTER TABLE "records_media_materials" ADD CONSTRAINT "records_media_materials_upload_id_records_upload_intents_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."records_upload_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_materials" ADD CONSTRAINT "records_media_materials_record_collection_id_records_upload_collections_id_fk" FOREIGN KEY ("record_collection_id") REFERENCES "public"."records_upload_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_materials" ADD CONSTRAINT "records_media_materials_original_version_id_records_upload_objects_original_version_id_fk" FOREIGN KEY ("original_version_id") REFERENCES "public"."records_upload_objects"("original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_materials" ADD CONSTRAINT "records_media_materials_scope_audit_id_audit_events_id_fk" FOREIGN KEY ("scope_audit_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_materials" ADD CONSTRAINT "records_media_materials_input_id_input_version_records_arrange_inputs_id_input_version_fk" FOREIGN KEY ("input_id","input_version") REFERENCES "public"."records_arrange_inputs"("id","input_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_review_draft_dependencies" ADD CONSTRAINT "records_media_review_draft_dependencies_operation_id_records_media_review_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."records_media_review_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_review_draft_dependencies" ADD CONSTRAINT "records_media_review_draft_dependencies_item_id_records_media_review_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."records_media_review_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_review_draft_dependencies" ADD CONSTRAINT "records_media_review_draft_dependencies_draft_id_records_drafts_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."records_drafts"("draft_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_review_items" ADD CONSTRAINT "records_media_review_items_material_id_records_media_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."records_media_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_review_items" ADD CONSTRAINT "records_media_review_items_current_operation_id_material_id_records_media_review_operations_id_material_id_fk" FOREIGN KEY ("current_operation_id","material_id") REFERENCES "public"."records_media_review_operations"("id","material_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_review_operations" ADD CONSTRAINT "records_media_review_operations_actor_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_review_operations" ADD CONSTRAINT "records_media_review_operations_actor_person_id_directory_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_review_operations" ADD CONSTRAINT "records_media_review_operations_source_operation_id_records_media_review_operations_id_fk" FOREIGN KEY ("source_operation_id") REFERENCES "public"."records_media_review_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_review_operations" ADD CONSTRAINT "records_media_review_operations_audit_id_audit_events_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_media_review_operations" ADD CONSTRAINT "records_media_review_operations_item_id_material_id_records_media_review_items_id_material_id_fk" FOREIGN KEY ("item_id","material_id") REFERENCES "public"."records_media_review_items"("id","material_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_arrange_inputs" ADD CONSTRAINT "records_arrange_original_input" CHECK (jsonb_typeof("records_arrange_inputs"."original_input") = 'object' and (
        coalesce(jsonb_typeof("records_arrange_inputs"."original_input"->'text') = 'string' and ("records_arrange_inputs"."original_input"->>'text') ~ '[^[:space:]]', false)
        or coalesce("records_arrange_inputs"."original_input"->>'kind' = 'media' and jsonb_typeof("records_arrange_inputs"."original_input"->'operationId') = 'string'
          and ("records_arrange_inputs"."original_input"->>'operationId') ~ '[^[:space:]]'
          and jsonb_typeof("records_arrange_inputs"."original_input"->'materialIds') = 'array'
          and jsonb_array_length("records_arrange_inputs"."original_input"->'materialIds') between 1 and 10, false)
      ));