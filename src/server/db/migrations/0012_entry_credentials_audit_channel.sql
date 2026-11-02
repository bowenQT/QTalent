CREATE TABLE "entry_agent_api_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"account_binding_digest" text NOT NULL,
	"revision" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	CONSTRAINT "entry_agent_session" UNIQUE("agent_id","session_id"),
	CONSTRAINT "entry_agent_revision" CHECK ("entry_agent_api_bindings"."revision" > 0),
	CONSTRAINT "entry_agent_digest" CHECK ("entry_agent_api_bindings"."account_binding_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "entry_agent_key" CHECK (length("entry_agent_api_bindings"."agent_id") between 1 and 200 and "entry_agent_api_bindings"."agent_id" !~ '[[:space:][:cntrl:]]')
);
--> statement-breakpoint
CREATE TABLE "entry_mcp_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"account_binding_digest" text NOT NULL,
	"revision" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"token_digest" text NOT NULL,
	CONSTRAINT "entry_mcp_credentials_token_digest_unique" UNIQUE("token_digest"),
	CONSTRAINT "entry_mcp_revision" CHECK ("entry_mcp_credentials"."revision" > 0),
	CONSTRAINT "entry_mcp_digests" CHECK ("entry_mcp_credentials"."token_digest" ~ '^[a-f0-9]{64}$' and "entry_mcp_credentials"."account_binding_digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "entry_wecom_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"account_binding_digest" text NOT NULL,
	"revision" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"scope" text NOT NULL,
	"bot_id" text NOT NULL,
	"sender_id" text NOT NULL,
	CONSTRAINT "entry_wecom_sender" UNIQUE("scope","bot_id","sender_id"),
	CONSTRAINT "entry_wecom_revision" CHECK ("entry_wecom_bindings"."revision" > 0),
	CONSTRAINT "entry_wecom_digest" CHECK ("entry_wecom_bindings"."account_binding_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "entry_wecom_keys" CHECK (length("entry_wecom_bindings"."scope") between 1 and 200 and length("entry_wecom_bindings"."bot_id") between 1 and 200 and length("entry_wecom_bindings"."sender_id") between 1 and 200 and "entry_wecom_bindings"."scope" !~ '[[:space:][:cntrl:]]' and "entry_wecom_bindings"."bot_id" !~ '[[:space:][:cntrl:]]' and "entry_wecom_bindings"."sender_id" !~ '[[:space:][:cntrl:]]')
);
--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "resource_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "entry_agent_api_bindings" ADD CONSTRAINT "entry_agent_api_bindings_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_agent_api_bindings" ADD CONSTRAINT "entry_agent_api_bindings_session_id_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_mcp_credentials" ADD CONSTRAINT "entry_mcp_credentials_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_wecom_bindings" ADD CONSTRAINT "entry_wecom_bindings_account_id_directory_account_bindings_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."directory_account_bindings"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_entry_metadata" CHECK ("audit_events"."metadata" is null or (
      jsonb_typeof("audit_events"."metadata") = 'object'
      and ("audit_events"."metadata" - 'channel' - 'revision') = '{}'::jsonb
      and coalesce(("audit_events"."metadata"->'channel') in ('"web"'::jsonb,'"wecom"'::jsonb,'"mcp"'::jsonb,'"agentapi"'::jsonb), false)
      and coalesce(("audit_events"."metadata"->'revision') = 'null'::jsonb or
        (jsonb_typeof("audit_events"."metadata"->'revision') = 'number' and ("audit_events"."metadata"->>'revision') ~ '^[1-9][0-9]*$' and ("audit_events"."metadata"->>'revision')::numeric <= 9007199254740991), false)
      and octet_length("audit_events"."metadata"::text) <= 256
    ));