CREATE TABLE "evaluation_rule_version_applicability" (
	"period_id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"category" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	CONSTRAINT "evaluation_rule_applicability_category" CHECK ("evaluation_rule_version_applicability"."category" in ('dimension_anchors', 'xe_selection', 'xe_weekly')),
	CONSTRAINT "evaluation_rule_applicability_version_category" CHECK (
      ("evaluation_rule_version_applicability"."category" = 'dimension_anchors' and "evaluation_rule_version_applicability"."version_id" ~ '^rubric-v[1-9][0-9]*$') or
      ("evaluation_rule_version_applicability"."category" = 'xe_selection' and "evaluation_rule_version_applicability"."version_id" ~ '^xe-select-v[1-9][0-9]*$') or
      ("evaluation_rule_version_applicability"."category" = 'xe_weekly' and "evaluation_rule_version_applicability"."version_id" ~ '^xe-weekly-v[1-9][0-9]*$')
    ),
	CONSTRAINT "evaluation_rule_applicability_window" CHECK (
      isfinite("evaluation_rule_version_applicability"."effective_from") and
      ("evaluation_rule_version_applicability"."effective_until" is null or (isfinite("evaluation_rule_version_applicability"."effective_until") and "evaluation_rule_version_applicability"."effective_until" >= "evaluation_rule_version_applicability"."effective_from"))
    )
);
--> statement-breakpoint
ALTER TABLE "evaluation_rule_version_applicability" ADD CONSTRAINT "evaluation_rule_version_applicability_version_id_evaluation_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."evaluation_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evaluation_rule_applicability_version_idx" ON "evaluation_rule_version_applicability" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "evaluation_rule_applicability_lookup_idx" ON "evaluation_rule_version_applicability" USING btree ("category","effective_from");