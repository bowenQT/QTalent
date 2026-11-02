CREATE TABLE "records_upload_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"target" jsonb NOT NULL,
	"target_fingerprint" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "records_upload_collection_operation" UNIQUE("creator_account_id","operation_id"),
	CONSTRAINT "records_upload_collection_fingerprint" CHECK ("records_upload_collections"."target_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "records_upload_collection_revision" CHECK ("records_upload_collections"."revision" > 0),
	CONSTRAINT "records_upload_collection_window" CHECK ("records_upload_collections"."expires_at" > "records_upload_collections"."created_at"),
	CONSTRAINT "records_upload_collection_target" CHECK (coalesce(jsonb_typeof("records_upload_collections"."target") = 'object' and "records_upload_collections"."target"->>'kind' in ('people','event'), false))
);
--> statement-breakpoint
CREATE TABLE "records_upload_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"quota_scope" text NOT NULL,
	"record_collection_id" text NOT NULL,
	"request" jsonb NOT NULL,
	"declared_bytes" bigint NOT NULL,
	"object_key" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"revision" integer NOT NULL,
	"completion_operation_id" text,
	"completion_fingerprint" text,
	"completed" jsonb,
	"released_at" bigint,
	"release_operation_id" text,
	"release_fingerprint" text,
	CONSTRAINT "records_upload_intents_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "records_upload_operation" UNIQUE("account_id","operation_id"),
	CONSTRAINT "records_upload_size" CHECK (coalesce("records_upload_intents"."declared_bytes" > 0 and "records_upload_intents"."declared_bytes" <= 2147483648 and ("records_upload_intents"."request"->>'declaredBytes')::bigint = "records_upload_intents"."declared_bytes", false)),
	CONSTRAINT "records_upload_revision" CHECK ("records_upload_intents"."revision" > 0),
	CONSTRAINT "records_upload_release" CHECK (("records_upload_intents"."released_at" is null and "records_upload_intents"."release_operation_id" is null and "records_upload_intents"."release_fingerprint" is null) or ("records_upload_intents"."released_at" is not null and "records_upload_intents"."release_operation_id" is not null and "records_upload_intents"."release_fingerprint" is not null and "records_upload_intents"."release_fingerprint" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "records_upload_collection_scope" CHECK (coalesce("records_upload_intents"."quota_scope" = "records_upload_intents"."record_collection_id" and "records_upload_intents"."request"->>'recordCollectionId' = "records_upload_intents"."record_collection_id", false)),
	CONSTRAINT "records_upload_fingerprint" CHECK ("records_upload_intents"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "records_upload_completion" CHECK (("records_upload_intents"."completed" is null and "records_upload_intents"."completion_operation_id" is null and "records_upload_intents"."completion_fingerprint" is null) or ("records_upload_intents"."completed" is not null and "records_upload_intents"."completion_operation_id" is not null and "records_upload_intents"."completion_fingerprint" is not null and "records_upload_intents"."completion_fingerprint" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "records_upload_objects" (
	"original_version_id" text PRIMARY KEY NOT NULL,
	"upload_id" text NOT NULL,
	"object_key" text NOT NULL,
	"byte_length" bigint NOT NULL,
	"media_type" text NOT NULL,
	"sha256" text NOT NULL,
	"etag" text NOT NULL,
	CONSTRAINT "records_upload_objects_upload_id_unique" UNIQUE("upload_id"),
	CONSTRAINT "records_upload_objects_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "records_upload_object_size" CHECK ("records_upload_objects"."byte_length" > 0 and "records_upload_objects"."byte_length" <= 2147483648),
	CONSTRAINT "records_upload_object_digest" CHECK ("records_upload_objects"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "records_upload_read_tickets" (
	"digest" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"fragment_id" text,
	"original_id" text NOT NULL,
	"original_version_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"requested_range" jsonb,
	CONSTRAINT "records_upload_ticket_digest" CHECK ("records_upload_read_tickets"."digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "records_upload_intents" ADD CONSTRAINT "records_upload_intents_record_collection_id_records_upload_collections_id_fk" FOREIGN KEY ("record_collection_id") REFERENCES "public"."records_upload_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_upload_objects" ADD CONSTRAINT "records_upload_objects_original_version_id_records_original_versions_id_fk" FOREIGN KEY ("original_version_id") REFERENCES "public"."records_original_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_upload_objects" ADD CONSTRAINT "records_upload_objects_upload_id_records_upload_intents_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."records_upload_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_upload_read_tickets" ADD CONSTRAINT "records_upload_read_tickets_original_id_records_originals_id_fk" FOREIGN KEY ("original_id") REFERENCES "public"."records_originals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_upload_read_tickets" ADD CONSTRAINT "records_upload_read_tickets_original_version_id_records_upload_objects_original_version_id_fk" FOREIGN KEY ("original_version_id") REFERENCES "public"."records_upload_objects"("original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_upload_read_tickets" ADD CONSTRAINT "records_upload_read_tickets_fragment_id_original_version_id_records_fragments_id_original_version_id_fk" FOREIGN KEY ("fragment_id","original_version_id") REFERENCES "public"."records_fragments"("id","original_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "records_upload_quota" ON "records_upload_intents" USING btree ("quota_scope","expires_at");--> statement-breakpoint
CREATE INDEX "records_upload_ticket_expiry" ON "records_upload_read_tickets" USING btree ("expires_at");