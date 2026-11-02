CREATE TABLE "staffing_match_operations" (
	"account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "staffing_match_operations_account_id_operation_id_pk" PRIMARY KEY("account_id","operation_id"),
	CONSTRAINT "staffing_match_operation_identity" CHECK (coalesce("staffing_match_operations"."payload"->>'runId' = "staffing_match_operations"."run_id", false))
);
--> statement-breakpoint
CREATE TABLE "staffing_match_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"demand_id" text NOT NULL,
	"demand_revision" integer NOT NULL,
	"initiator_account_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "staffing_match_identity" CHECK (coalesce("staffing_match_runs"."payload"->>'id' = "staffing_match_runs"."id" and "staffing_match_runs"."payload"->>'initiatorAccountId' = "staffing_match_runs"."initiator_account_id" and "staffing_match_runs"."payload"->'demand'->>'id' = "staffing_match_runs"."demand_id" and ("staffing_match_runs"."payload"->'demand'->>'revision')::integer = "staffing_match_runs"."demand_revision" and "staffing_match_runs"."demand_revision" > 0 and "staffing_match_runs"."payload"->'demand'->>'status' = 'confirmed' and "staffing_match_runs"."payload"->>'schemaVersion' = '1', false))
);
--> statement-breakpoint
ALTER TABLE "staffing_match_operations" ADD CONSTRAINT "staffing_match_operations_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_match_operations" ADD CONSTRAINT "staffing_match_operations_run_id_staffing_match_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."staffing_match_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_match_runs" ADD CONSTRAINT "staffing_match_runs_id_job_snapshots_job_id_fk" FOREIGN KEY ("id") REFERENCES "public"."job_snapshots"("job_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_match_runs" ADD CONSTRAINT "staffing_match_runs_initiator_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("initiator_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_match_runs" ADD CONSTRAINT "staffing_match_runs_demand_id_demand_revision_staffing_demand_versions_demand_id_revision_fk" FOREIGN KEY ("demand_id","demand_revision") REFERENCES "public"."staffing_demand_versions"("demand_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staffing_match_demand_idx" ON "staffing_match_runs" USING btree ("demand_id","demand_revision");