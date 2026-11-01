CREATE TABLE "programs_evaluation_node_subjects" (
	"evaluation_node_id" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "programs_evaluation_node_subjects_evaluation_node_id_person_id_pk" PRIMARY KEY("evaluation_node_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "programs_evaluation_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"cohort_id" text,
	CONSTRAINT "programs_node_kind" CHECK ("programs_evaluation_nodes"."kind" in ('program_cohort','interview','defense')),
	CONSTRAINT "programs_node_name" CHECK (length(trim("programs_evaluation_nodes"."name")) > 0),
	CONSTRAINT "programs_program_node_cohort" CHECK ("programs_evaluation_nodes"."kind" <> 'program_cohort' or "programs_evaluation_nodes"."cohort_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "programs_evaluation_reassignment_operations" (
	"account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"receipt" jsonb NOT NULL,
	CONSTRAINT "programs_reassignment_actor_operation_pk" PRIMARY KEY("account_id","operation_id"),
	CONSTRAINT "programs_reassignment_fingerprint" CHECK ("programs_evaluation_reassignment_operations"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "programs_evaluation_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_node_id" text NOT NULL,
	"person_id" text NOT NULL,
	"evaluator_id" text NOT NULL,
	"kind" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"legacy_assignment_id" text,
	CONSTRAINT "programs_relation_assignment_identity" UNIQUE("id","evaluation_node_id","person_id","evaluator_id"),
	CONSTRAINT "programs_relation_legacy_assignment" UNIQUE("legacy_assignment_id"),
	CONSTRAINT "programs_relation_kind" CHECK ("programs_evaluation_relations"."kind" in ('evaluator','mentor','assistant','interviewer','judge')),
	CONSTRAINT "programs_relation_validity" CHECK ("programs_evaluation_relations"."valid_to" is null or "programs_evaluation_relations"."valid_to" > "programs_evaluation_relations"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "programs_evaluation_work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_node_id" text NOT NULL,
	"person_id" text NOT NULL,
	"assigned_relation_id" text NOT NULL,
	"assigned_evaluator_id" text NOT NULL,
	"kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "programs_work_resource_identity" UNIQUE("evaluation_node_id","person_id","kind","resource_id"),
	CONSTRAINT "programs_work_revision" CHECK ("programs_evaluation_work_items"."revision" > 0),
	CONSTRAINT "programs_work_kind" CHECK ("programs_evaluation_work_items"."kind" in ('confirmation','speaker','unknown_person','image_scope','unknown_interviewer','unknown_project','unknown_interview_candidate')),
	CONSTRAINT "programs_work_state" CHECK ("programs_evaluation_work_items"."state" in ('pending','processing','completed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "records_events" ADD COLUMN "evaluation_node_id" text;--> statement-breakpoint
ALTER TABLE "records_historical_evaluations" ADD COLUMN "evaluation_node_id" text;--> statement-breakpoint
ALTER TABLE "programs_evaluation_node_subjects" ADD CONSTRAINT "programs_evaluation_node_subjects_evaluation_node_id_programs_evaluation_nodes_id_fk" FOREIGN KEY ("evaluation_node_id") REFERENCES "public"."programs_evaluation_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_evaluation_node_subjects" ADD CONSTRAINT "programs_evaluation_node_subjects_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_evaluation_nodes" ADD CONSTRAINT "programs_evaluation_nodes_cohort_id_programs_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."programs_cohorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_evaluation_reassignment_operations" ADD CONSTRAINT "programs_evaluation_reassignment_operations_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_evaluation_reassignment_operations" ADD CONSTRAINT "programs_evaluation_reassignment_operations_work_item_id_programs_evaluation_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."programs_evaluation_work_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_evaluation_relations" ADD CONSTRAINT "programs_evaluation_relations_evaluator_id_directory_people_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_evaluation_relations" ADD CONSTRAINT "programs_evaluation_relations_legacy_assignment_id_programs_assignments_id_fk" FOREIGN KEY ("legacy_assignment_id") REFERENCES "public"."programs_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_evaluation_relations" ADD CONSTRAINT "programs_evaluation_relations_evaluation_node_id_person_id_programs_evaluation_node_subjects_evaluation_node_id_person_id_fk" FOREIGN KEY ("evaluation_node_id","person_id") REFERENCES "public"."programs_evaluation_node_subjects"("evaluation_node_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_evaluation_work_items" ADD CONSTRAINT "programs_evaluation_work_items_assigned_relation_id_evaluation_node_id_person_id_assigned_evaluator_id_programs_evaluation_relations_id_evaluation_node_id_person_id_evaluator_id_fk" FOREIGN KEY ("assigned_relation_id","evaluation_node_id","person_id","assigned_evaluator_id") REFERENCES "public"."programs_evaluation_relations"("id","evaluation_node_id","person_id","evaluator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "programs_one_cohort_node" ON "programs_evaluation_nodes" USING btree ("cohort_id") WHERE "programs_evaluation_nodes"."kind" = 'program_cohort';--> statement-breakpoint
CREATE INDEX "programs_relation_actor_node_subject_idx" ON "programs_evaluation_relations" USING btree ("evaluator_id","evaluation_node_id","person_id");--> statement-breakpoint
CREATE INDEX "programs_work_assignment_state_idx" ON "programs_evaluation_work_items" USING btree ("assigned_relation_id","state");--> statement-breakpoint
ALTER TABLE "records_events" ADD CONSTRAINT "records_events_evaluation_node_id_programs_evaluation_nodes_id_fk" FOREIGN KEY ("evaluation_node_id") REFERENCES "public"."programs_evaluation_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_events" ADD CONSTRAINT "records_events_evaluation_node_id_person_id_programs_evaluation_node_subjects_evaluation_node_id_person_id_fk" FOREIGN KEY ("evaluation_node_id","person_id") REFERENCES "public"."programs_evaluation_node_subjects"("evaluation_node_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_historical_evaluations" ADD CONSTRAINT "records_historical_evaluations_evaluation_node_id_programs_evaluation_nodes_id_fk" FOREIGN KEY ("evaluation_node_id") REFERENCES "public"."programs_evaluation_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_historical_evaluations" ADD CONSTRAINT "records_historical_evaluations_evaluation_node_id_person_id_programs_evaluation_node_subjects_evaluation_node_id_person_id_fk" FOREIGN KEY ("evaluation_node_id","person_id") REFERENCES "public"."programs_evaluation_node_subjects"("evaluation_node_id","person_id") ON DELETE no action ON UPDATE no action;