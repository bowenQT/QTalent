CREATE TABLE "records_wecom_messages" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"bot_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"message_id" text NOT NULL,
	"actor_account_id" text NOT NULL,
	"actor_person_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"credential_revision" integer NOT NULL,
	"input_digest" text NOT NULL,
	"part_count" integer NOT NULL,
	"evaluation_node_id" text,
	"person_ids" jsonb,
	"project_id" text,
	"collection_id" text,
	"archive_refs" jsonb NOT NULL,
	"input_id" text,
	"batch_id" text,
	"job_id" text,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "records_wecom_message_identity" UNIQUE("scope","bot_id","sender_id","message_id"),
	CONSTRAINT "records_wecom_message_digests" CHECK ("records_wecom_messages"."key" ~ '^[a-f0-9]{64}$' and "records_wecom_messages"."input_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "records_wecom_message_revisions" CHECK ("records_wecom_messages"."revision" > 0 and "records_wecom_messages"."credential_revision" > 0 and "records_wecom_messages"."part_count" between 1 and 20 and "records_wecom_messages"."updated_at" >= "records_wecom_messages"."created_at"),
	CONSTRAINT "records_wecom_message_target" CHECK (("records_wecom_messages"."evaluation_node_id" is null and "records_wecom_messages"."person_ids" is null and "records_wecom_messages"."project_id" is null and "records_wecom_messages"."collection_id" is null) or ("records_wecom_messages"."evaluation_node_id" is not null and "records_wecom_messages"."person_ids" is not null and jsonb_typeof("records_wecom_messages"."person_ids") = 'array' and octet_length("records_wecom_messages"."person_ids"::text) <= 65536 and not jsonb_path_exists("records_wecom_messages"."person_ids", '$[*] ? (@.type() != "string" || !(@ like_regex "^.{1,200}$"))'))),
	CONSTRAINT "records_wecom_message_result" CHECK (("records_wecom_messages"."input_id" is null and "records_wecom_messages"."batch_id" is null and "records_wecom_messages"."job_id" is null) or ("records_wecom_messages"."input_id" is not null and "records_wecom_messages"."batch_id" is not null and "records_wecom_messages"."job_id" is not null and "records_wecom_messages"."evaluation_node_id" is not null)),
	CONSTRAINT "records_wecom_archives" CHECK (jsonb_typeof("records_wecom_messages"."archive_refs") = 'array' and jsonb_array_length("records_wecom_messages"."archive_refs") <= 20 and octet_length("records_wecom_messages"."archive_refs"::text) <= 16384
    and not jsonb_path_exists("records_wecom_messages"."archive_refs", '$[*] ? (@.type() != "object" || !exists(@.partIndex) || !exists(@.kind) || !exists(@.uploadId) || !exists(@.originalVersionId) || !exists(@.sha256))')
    and not jsonb_path_exists("records_wecom_messages"."archive_refs", '$[*].keyvalue() ? (@.key != "partIndex" && @.key != "kind" && @.key != "uploadId" && @.key != "originalVersionId" && @.key != "sha256")')
    and not jsonb_path_exists("records_wecom_messages"."archive_refs", '$[*] ? (@.partIndex.type() != "number" || @.partIndex < 0 || @.partIndex > 19 || @.partIndex.floor() != @.partIndex || (@.kind != "image" && @.kind != "file") || @.uploadId.type() != "string" || !(@.uploadId like_regex "^.{1,200}$") || @.originalVersionId.type() != "string" || !(@.originalVersionId like_regex "^.{1,200}$") || @.sha256.type() != "string" || !(@.sha256 like_regex "^[a-f0-9]{64}$"))'))
);
--> statement-breakpoint
CREATE TABLE "records_wecom_receipt_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"message_key" text NOT NULL,
	"kind" text NOT NULL,
	"batch_id" text,
	"batch_revision" integer,
	"batch_status" text,
	"fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "records_wecom_receipt_identity" UNIQUE NULLS NOT DISTINCT("message_key","kind","batch_id","batch_revision","batch_status"),
	CONSTRAINT "records_wecom_receipt_digests" CHECK ("records_wecom_receipt_attempts"."key" ~ '^[a-f0-9]{64}$' and "records_wecom_receipt_attempts"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "records_wecom_receipt_shape" CHECK (("records_wecom_receipt_attempts"."kind" = 'group_ack' and "records_wecom_receipt_attempts"."batch_id" is null and "records_wecom_receipt_attempts"."batch_revision" is null and "records_wecom_receipt_attempts"."batch_status" is null) or ("records_wecom_receipt_attempts"."kind" = 'private_receipt' and "records_wecom_receipt_attempts"."batch_id" is not null and "records_wecom_receipt_attempts"."batch_revision" is not null and "records_wecom_receipt_attempts"."batch_revision" > 0 and "records_wecom_receipt_attempts"."batch_status" is not null and "records_wecom_receipt_attempts"."batch_status" in ('processing','needs_review','awaiting_confirmation','failed'))),
	CONSTRAINT "records_wecom_receipt_state" CHECK (("records_wecom_receipt_attempts"."state" in ('reserved','outcome_unknown') and "records_wecom_receipt_attempts"."acknowledged_at" is null) or ("records_wecom_receipt_attempts"."state" = 'acknowledged' and "records_wecom_receipt_attempts"."acknowledged_at" is not null and "records_wecom_receipt_attempts"."acknowledged_at" >= "records_wecom_receipt_attempts"."attempted_at"))
);
--> statement-breakpoint
ALTER TABLE "records_wecom_messages" ADD CONSTRAINT "records_wecom_messages_actor_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_wecom_messages" ADD CONSTRAINT "records_wecom_messages_actor_person_id_directory_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_wecom_messages" ADD CONSTRAINT "records_wecom_messages_credential_id_entry_wecom_bindings_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."entry_wecom_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_wecom_messages" ADD CONSTRAINT "records_wecom_messages_evaluation_node_id_programs_evaluation_nodes_id_fk" FOREIGN KEY ("evaluation_node_id") REFERENCES "public"."programs_evaluation_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_wecom_messages" ADD CONSTRAINT "records_wecom_messages_project_id_staffing_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."staffing_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_wecom_messages" ADD CONSTRAINT "records_wecom_messages_input_id_records_arrange_inputs_id_fk" FOREIGN KEY ("input_id") REFERENCES "public"."records_arrange_inputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_wecom_messages" ADD CONSTRAINT "records_wecom_messages_job_id_job_snapshots_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_snapshots"("job_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_wecom_receipt_attempts" ADD CONSTRAINT "records_wecom_receipt_attempts_message_key_records_wecom_messages_key_fk" FOREIGN KEY ("message_key") REFERENCES "public"."records_wecom_messages"("key") ON DELETE no action ON UPDATE no action;