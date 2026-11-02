CREATE TABLE "programs_node_conclusion_operations" (
	"account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"conclusion_id" text NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "programs_node_conclusion_operations_account_id_operation_id_pk" PRIMARY KEY("account_id","operation_id"),
	CONSTRAINT "programs_node_conclusion_operation_fingerprint" CHECK ("programs_node_conclusion_operations"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "programs_node_conclusion_versions" (
	"conclusion_id" text NOT NULL,
	"version" integer NOT NULL,
	"evaluation_node_id" text NOT NULL,
	"person_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "programs_node_conclusion_versions_conclusion_id_version_pk" PRIMARY KEY("conclusion_id","version"),
	CONSTRAINT "programs_node_conclusion_positive_version" CHECK ("programs_node_conclusion_versions"."version" > 0),
	CONSTRAINT "programs_node_conclusion_payload_identity" CHECK (jsonb_typeof("programs_node_conclusion_versions"."payload") = 'object'
        and ("programs_node_conclusion_versions"."payload"->>'id') is not distinct from "programs_node_conclusion_versions"."conclusion_id"
        and ("programs_node_conclusion_versions"."payload"->>'evaluationNodeId') is not distinct from "programs_node_conclusion_versions"."evaluation_node_id"
        and ("programs_node_conclusion_versions"."payload"->>'personId') is not distinct from "programs_node_conclusion_versions"."person_id"
        and ("programs_node_conclusion_versions"."payload"->'version') is not distinct from to_jsonb("programs_node_conclusion_versions"."version")
        and ("programs_node_conclusion_versions"."payload"->>'conclusionType') is not distinct from 'defense'
        and ("programs_node_conclusion_versions"."payload"->>'origin') is not distinct from 'human_conclusion')
);
--> statement-breakpoint
CREATE TABLE "programs_node_conclusions" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_node_id" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "programs_node_conclusion_subject" UNIQUE("evaluation_node_id","person_id"),
	CONSTRAINT "programs_node_conclusion_identity" UNIQUE("id","evaluation_node_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "programs_node_conclusion_operations" ADD CONSTRAINT "programs_node_conclusion_operations_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_node_conclusion_operations" ADD CONSTRAINT "programs_node_conclusion_operation_version_fk" FOREIGN KEY ("conclusion_id","version") REFERENCES "public"."programs_node_conclusion_versions"("conclusion_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_node_conclusion_versions" ADD CONSTRAINT "programs_node_conclusion_version_identity_fk" FOREIGN KEY ("conclusion_id","evaluation_node_id","person_id") REFERENCES "public"."programs_node_conclusions"("id","evaluation_node_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_node_conclusions" ADD CONSTRAINT "programs_node_conclusion_subject_fk" FOREIGN KEY ("evaluation_node_id","person_id") REFERENCES "public"."programs_evaluation_node_subjects"("evaluation_node_id","person_id") ON DELETE no action ON UPDATE no action;