ALTER TABLE "directory_organizations" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "directory_organizations" ADD COLUMN "hierarchy_known" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_organizations" ADD COLUMN "is_group" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_people" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "directory_people" ADD COLUMN "job_level" text;--> statement-breakpoint
ALTER TABLE "directory_organizations" ADD CONSTRAINT "directory_organizations_parent_id_directory_organizations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."directory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_organizations" ADD CONSTRAINT "directory_organizations_parent_not_self" CHECK ("directory_organizations"."parent_id" is null or "directory_organizations"."parent_id" <> "directory_organizations"."id");--> statement-breakpoint
ALTER TABLE "directory_organizations" ADD CONSTRAINT "directory_organizations_unknown_parent_null" CHECK ("directory_organizations"."hierarchy_known" or "directory_organizations"."parent_id" is null);--> statement-breakpoint
ALTER TABLE "directory_organizations" ADD CONSTRAINT "directory_organizations_unknown_not_group" CHECK ("directory_organizations"."hierarchy_known" or not "directory_organizations"."is_group");--> statement-breakpoint
ALTER TABLE "directory_people" ADD CONSTRAINT "directory_people_job_title_nonblank" CHECK ("directory_people"."job_title" is null or "directory_people"."job_title" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "directory_people" ADD CONSTRAINT "directory_people_job_level_nonblank" CHECK ("directory_people"."job_level" is null or "directory_people"."job_level" ~ '[^[:space:]]');