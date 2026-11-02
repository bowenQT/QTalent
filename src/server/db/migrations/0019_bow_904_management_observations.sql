CREATE TABLE "records_management_observation_operations" (
	"account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"observation_id" text NOT NULL,
	CONSTRAINT "records_management_observation_operations_account_id_operation_id_pk" PRIMARY KEY("account_id","operation_id"),
	CONSTRAINT "records_observation_operation_key" CHECK (char_length("records_management_observation_operations"."operation_id") between 1 and 200 and "records_management_observation_operations"."operation_id" ~ '[^[:space:]]'),
	CONSTRAINT "records_observation_operation_fingerprint" CHECK ("records_management_observation_operations"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "records_management_observation_sources" (
	"observation_id" text NOT NULL,
	"position" integer NOT NULL,
	"fragment_id" text NOT NULL,
	"original_version_id" text NOT NULL,
	CONSTRAINT "records_management_observation_sources_observation_id_fragment_id_pk" PRIMARY KEY("observation_id","fragment_id"),
	CONSTRAINT "records_observation_source_position" UNIQUE("observation_id","position"),
	CONSTRAINT "records_observation_source_position_range" CHECK ("records_management_observation_sources"."position" between 0 and 99)
);
--> statement-breakpoint
CREATE TABLE "records_management_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_node_id" text NOT NULL,
	"person_id" text NOT NULL,
	"text" text NOT NULL,
	"origin" text NOT NULL,
	"author_person_id" text,
	"author_name" text NOT NULL,
	"author_unconfirmed" boolean NOT NULL,
	"imported_by_account_id" text,
	"imported_by_person_id" text,
	"imported_by_name" text,
	"recorded_by_account_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"occurred_at" text NOT NULL,
	"attribution_id" text,
	CONSTRAINT "records_observation_actor_identity" UNIQUE("id","recorded_by_account_id"),
	CONSTRAINT "records_observation_text" CHECK (char_length("records_management_observations"."text") between 1 and 100000 and "records_management_observations"."text" ~ '[^[:space:]]'),
	CONSTRAINT "records_observation_author" CHECK (char_length("records_management_observations"."author_name") between 1 and 100000 and "records_management_observations"."author_name" ~ '[^[:space:]]'),
	CONSTRAINT "records_observation_occurred" CHECK ("records_management_observations"."occurred_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}($|T)'),
	CONSTRAINT "records_observation_origin_attribution" CHECK (coalesce(
    ("records_management_observations"."origin" = 'manual' and "records_management_observations"."author_person_id" is not null and not "records_management_observations"."author_unconfirmed"
      and "records_management_observations"."imported_by_account_id" is null and "records_management_observations"."imported_by_person_id" is null and "records_management_observations"."imported_by_name" is null and "records_management_observations"."attribution_id" is null)
    or ("records_management_observations"."origin" = 'interview_import' and "records_management_observations"."author_unconfirmed"
      and "records_management_observations"."imported_by_account_id" = "records_management_observations"."recorded_by_account_id" and "records_management_observations"."imported_by_person_id" is not null
      and "records_management_observations"."imported_by_name" ~ '[^[:space:]]' and "records_management_observations"."attribution_id" ~ '[^[:space:]]'), false))
);
--> statement-breakpoint
ALTER TABLE "records_management_observation_operations" ADD CONSTRAINT "records_management_observation_operations_observation_id_account_id_records_management_observations_id_recorded_by_account_id_fk" FOREIGN KEY ("observation_id","account_id") REFERENCES "public"."records_management_observations"("id","recorded_by_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_management_observation_sources" ADD CONSTRAINT "records_management_observation_sources_observation_id_records_management_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."records_management_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_management_observation_sources" ADD CONSTRAINT "records_management_observation_sources_fragment_id_original_version_id_records_fragments_id_original_version_id_fk" FOREIGN KEY ("fragment_id","original_version_id") REFERENCES "public"."records_fragments"("id","original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_management_observations" ADD CONSTRAINT "records_management_observations_author_person_id_directory_people_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_management_observations" ADD CONSTRAINT "records_management_observations_imported_by_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("imported_by_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_management_observations" ADD CONSTRAINT "records_management_observations_imported_by_person_id_directory_people_id_fk" FOREIGN KEY ("imported_by_person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_management_observations" ADD CONSTRAINT "records_management_observations_recorded_by_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_management_observations" ADD CONSTRAINT "records_management_observations_evaluation_node_id_person_id_programs_evaluation_node_subjects_evaluation_node_id_person_id_fk" FOREIGN KEY ("evaluation_node_id","person_id") REFERENCES "public"."programs_evaluation_node_subjects"("evaluation_node_id","person_id") ON DELETE no action ON UPDATE no action;