CREATE TABLE "staffing_demand_operations" (
	"account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"demand_id" text NOT NULL,
	"revision" integer,
	CONSTRAINT "staffing_demand_operations_account_id_operation_id_pk" PRIMARY KEY("account_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "staffing_demands" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"initiator_account_id" text NOT NULL,
	"initiator_person_id" text NOT NULL,
	"input_text" text NOT NULL,
	"created_at" text NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"prompt_version" text NOT NULL,
	"retryable" boolean DEFAULT false NOT NULL,
	"failure_kind" text,
	CONSTRAINT "staffing_demand_revision_nonnegative" CHECK ("staffing_demands"."current_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staffing_demand_versions" (
	"demand_id" text NOT NULL,
	"revision" integer NOT NULL,
	"demand" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"model_metadata" jsonb NOT NULL,
	"actor_account_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "staffing_demand_versions_demand_id_revision_pk" PRIMARY KEY("demand_id","revision"),
	CONSTRAINT "staffing_demand_version_positive" CHECK ("staffing_demand_versions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "staffing_demand_operations" ADD CONSTRAINT "staffing_demand_operations_demand_id_staffing_demands_id_fk" FOREIGN KEY ("demand_id") REFERENCES "public"."staffing_demands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_demands" ADD CONSTRAINT "staffing_demands_project_id_staffing_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."staffing_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_demand_versions" ADD CONSTRAINT "staffing_demand_versions_demand_id_staffing_demands_id_fk" FOREIGN KEY ("demand_id") REFERENCES "public"."staffing_demands"("id") ON DELETE no action ON UPDATE no action;