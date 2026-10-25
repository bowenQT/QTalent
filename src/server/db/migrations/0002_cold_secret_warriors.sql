CREATE TABLE "job_operations" (
	"job_id" text NOT NULL,
	"account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"record" jsonb NOT NULL,
	CONSTRAINT "job_operations_job_id_account_id_operation_id_pk" PRIMARY KEY("job_id","account_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "job_snapshots" (
	"job_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"input_version" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer NOT NULL,
	"revision" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"result" jsonb,
	"error_code" text,
	"cancel_requested_at" timestamp with time zone,
	CONSTRAINT "job_attempt_positive" CHECK ("job_snapshots"."attempt" > 0),
	CONSTRAINT "job_revision_positive" CHECK ("job_snapshots"."revision" > 0),
	CONSTRAINT "job_status_valid" CHECK ("job_snapshots"."status" in ('queued', 'running', 'partial', 'awaiting_manual', 'failed', 'completed', 'cancelled')),
	CONSTRAINT "job_error_valid" CHECK ("job_snapshots"."error_code" is null or "job_snapshots"."error_code" in ('processing_failed', 'input_changed', 'dependency_unavailable')),
	CONSTRAINT "job_cancelled_fenced" CHECK ("job_snapshots"."status" <> 'cancelled' or "job_snapshots"."cancel_requested_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "job_operations" ADD CONSTRAINT "job_operations_job_id_job_snapshots_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_snapshots"("job_id") ON DELETE no action ON UPDATE no action;