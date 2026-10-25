CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_account_bindings" (
	"account_id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"is_system_admin" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_employments" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "directory_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"role" text NOT NULL,
	"scope" text NOT NULL,
	"cohort_id" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"revoked_at" date
);
--> statement-breakpoint
CREATE TABLE "directory_organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"photo" text,
	"hue" integer DEFAULT 220 NOT NULL,
	"no_review" boolean DEFAULT false NOT NULL,
	"demo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"cohort_id" text NOT NULL,
	"person_id" text NOT NULL,
	"student_id" text NOT NULL,
	"kind" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"revoked_at" date
);
--> statement-breakpoint
CREATE TABLE "programs_cohorts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"cohort_id" text NOT NULL,
	"person_id" text NOT NULL,
	"confirmed" boolean NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"revoked_at" date
);
--> statement-breakpoint
CREATE TABLE "staffing_create_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"request_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staffing_member_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"at" date NOT NULL,
	"text" text NOT NULL,
	"by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staffing_members" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"person_id" text NOT NULL,
	"role" text NOT NULL,
	"mode" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staffing_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"goal" text NOT NULL,
	"organization_id" text NOT NULL,
	"cohort_id" text,
	"is_topic" boolean DEFAULT false NOT NULL,
	"owner_id" text,
	"creator_id" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_account_bindings" ADD CONSTRAINT "directory_account_bindings_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_employments" ADD CONSTRAINT "directory_employments_person_id_directory_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."directory_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_employments" ADD CONSTRAINT "directory_employments_organization_id_directory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."directory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_grants" ADD CONSTRAINT "directory_grants_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_people" ADD CONSTRAINT "directory_people_organization_id_directory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."directory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_assignments" ADD CONSTRAINT "programs_assignments_cohort_id_programs_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."programs_cohorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs_enrollments" ADD CONSTRAINT "programs_enrollments_cohort_id_programs_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."programs_cohorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_create_requests" ADD CONSTRAINT "staffing_create_requests_project_id_staffing_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."staffing_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_member_logs" ADD CONSTRAINT "staffing_member_logs_project_id_staffing_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."staffing_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_members" ADD CONSTRAINT "staffing_members_project_id_staffing_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."staffing_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "directory_employments_person_idx" ON "directory_employments" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "directory_grants_account_idx" ON "directory_grants" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "programs_assignments_person_idx" ON "programs_assignments" USING btree ("person_id","cohort_id");--> statement-breakpoint
CREATE INDEX "programs_enrollments_cohort_person_idx" ON "programs_enrollments" USING btree ("cohort_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staffing_request_account_key_idx" ON "staffing_create_requests" USING btree ("account_id","request_id");--> statement-breakpoint
CREATE INDEX "staffing_members_person_idx" ON "staffing_members" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staffing_members_unique_idx" ON "staffing_members" USING btree ("project_id","person_id","valid_from");--> statement-breakpoint
CREATE INDEX "staffing_projects_cohort_idx" ON "staffing_projects" USING btree ("cohort_id");--> statement-breakpoint
CREATE INDEX "audit_actor_at_idx" ON "audit_events" USING btree ("actor_id","at");