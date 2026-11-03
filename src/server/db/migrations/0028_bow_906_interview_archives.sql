CREATE TABLE "records_interview_import_archives" (
	"evaluation_id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_id" text NOT NULL,
	"import_revision" integer NOT NULL,
	"duplicate_key" text NOT NULL,
	"importer_person_id" text NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawal_audit_id" text,
	CONSTRAINT "records_interview_archive_revision" UNIQUE("batch_id","row_id","import_revision"),
	CONSTRAINT "records_interview_archive_identity" CHECK ("records_interview_import_archives"."duplicate_key" ~ '^[a-f0-9]{64}$' and "records_interview_import_archives"."import_revision" > 0),
	CONSTRAINT "records_interview_archive_withdrawal" CHECK (("records_interview_import_archives"."withdrawn_at" is null and "records_interview_import_archives"."withdrawal_audit_id" is null) or ("records_interview_import_archives"."withdrawn_at" is not null and "records_interview_import_archives"."withdrawal_audit_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "records_interview_import_archives" ADD CONSTRAINT "records_interview_import_archives_evaluation_id_records_historical_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."records_historical_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_archives" ADD CONSTRAINT "records_interview_import_archives_importer_person_id_directory_people_id_fk" FOREIGN KEY ("importer_person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_archives" ADD CONSTRAINT "records_interview_import_archives_withdrawal_audit_id_audit_events_id_fk" FOREIGN KEY ("withdrawal_audit_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_interview_import_archives" ADD CONSTRAINT "records_interview_archive_operation" FOREIGN KEY ("batch_id","row_id","import_revision") REFERENCES "public"."records_interview_import_operations"("batch_id","row_id","to_revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "records_interview_archive_active_row" ON "records_interview_import_archives" USING btree ("batch_id","row_id") WHERE "records_interview_import_archives"."withdrawn_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "records_interview_archive_active_identity" ON "records_interview_import_archives" USING btree ("duplicate_key") WHERE "records_interview_import_archives"."withdrawn_at" is null;