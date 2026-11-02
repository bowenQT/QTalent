CREATE TABLE "records_arrange_inputs" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_account_id" text NOT NULL,
	"job_id" text NOT NULL,
	"input_version" text NOT NULL,
	"batch_id" text,
	"evaluation_node_id" text,
	"bound_at" timestamp with time zone,
	"occurred_on" date,
	"origin" text NOT NULL,
	"original_input" jsonb NOT NULL,
	"source_contexts" jsonb NOT NULL,
	"input_source" jsonb,
	"person_ids" jsonb NOT NULL,
	"project_mode" text NOT NULL,
	"project_id" text,
	"project_candidate_ids" jsonb NOT NULL,
	"superseded_by_input_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "records_arrange_job" UNIQUE("job_id"),
	CONSTRAINT "records_arrange_version" UNIQUE("id","input_version"),
	CONSTRAINT "records_arrange_origin" CHECK ("records_arrange_inputs"."origin" in ('text','recording','attachment')),
	CONSTRAINT "records_arrange_project" CHECK (("records_arrange_inputs"."project_mode" = 'resolved' and "records_arrange_inputs"."project_id" is not null) or ("records_arrange_inputs"."project_mode" in ('none','needs_selection') and "records_arrange_inputs"."project_id" is null)),
	CONSTRAINT "records_arrange_source_arrays" CHECK (jsonb_typeof("records_arrange_inputs"."source_contexts") = 'array' and jsonb_typeof("records_arrange_inputs"."person_ids") = 'array' and jsonb_typeof("records_arrange_inputs"."project_candidate_ids") = 'array'),
	CONSTRAINT "records_arrange_original_input" CHECK (jsonb_typeof("records_arrange_inputs"."original_input") = 'object' and jsonb_typeof("records_arrange_inputs"."original_input"->'text') = 'string' and ("records_arrange_inputs"."original_input"->>'text') ~ '[^[:space:]]'),
	CONSTRAINT "records_arrange_new_input" CHECK ("records_arrange_inputs"."superseded_by_input_id" is null or "records_arrange_inputs"."superseded_by_input_id" <> "records_arrange_inputs"."id")
);
--> statement-breakpoint
CREATE TABLE "records_arrange_operations" (
	"actor_account_id" text NOT NULL,
	"action" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"input_id" text NOT NULL,
	"job_id" text NOT NULL,
	CONSTRAINT "records_arrange_operations_actor_account_id_action_operation_id_pk" PRIMARY KEY("actor_account_id","action","operation_id"),
	CONSTRAINT "records_arrange_operation_action" CHECK ("records_arrange_operations"."action" in ('create','select')),
	CONSTRAINT "records_arrange_operation_fingerprint" CHECK ("records_arrange_operations"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "records_arrange_inputs" ADD CONSTRAINT "records_arrange_inputs_creator_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("creator_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_arrange_inputs" ADD CONSTRAINT "records_arrange_inputs_job_id_job_snapshots_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_snapshots"("job_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_arrange_inputs" ADD CONSTRAINT "records_arrange_inputs_evaluation_node_id_programs_evaluation_nodes_id_fk" FOREIGN KEY ("evaluation_node_id") REFERENCES "public"."programs_evaluation_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_arrange_inputs" ADD CONSTRAINT "records_arrange_inputs_superseded_by_input_id_records_arrange_inputs_id_fk" FOREIGN KEY ("superseded_by_input_id") REFERENCES "public"."records_arrange_inputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_arrange_operations" ADD CONSTRAINT "records_arrange_operations_actor_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_arrange_operations" ADD CONSTRAINT "records_arrange_operations_input_id_records_arrange_inputs_id_fk" FOREIGN KEY ("input_id") REFERENCES "public"."records_arrange_inputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_arrange_operations" ADD CONSTRAINT "records_arrange_operations_job_id_job_snapshots_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_snapshots"("job_id") ON DELETE no action ON UPDATE no action;