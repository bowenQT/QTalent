CREATE TABLE "agentapi_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"binding_id" text,
	"account_id" text NOT NULL,
	"person_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"credential_revision" integer NOT NULL,
	"authorization_digest" text NOT NULL,
	"provider_session_id" text,
	"state" text NOT NULL,
	"cleanup" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentapi_conversations_provider_session_id_unique" UNIQUE("provider_session_id"),
	CONSTRAINT "agentapi_conversation_identity" CHECK (length("agentapi_conversations"."id") between 1 and 200
        and length("agentapi_conversations"."account_id") > 0 and length("agentapi_conversations"."person_id") > 0
        and length("agentapi_conversations"."credential_id") > 0 and "agentapi_conversations"."credential_revision" > 0
        and "agentapi_conversations"."authorization_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agentapi_conversation_provider" CHECK ("agentapi_conversations"."provider_session_id" is null or length("agentapi_conversations"."provider_session_id") > 0),
	CONSTRAINT "agentapi_conversation_state" CHECK ("agentapi_conversations"."state" in ('creating', 'active', 'invalidated', 'outcome_unknown', 'failed', 'cancelled')
        and ("agentapi_conversations"."state" <> 'active' or "agentapi_conversations"."provider_session_id" is not null)),
	CONSTRAINT "agentapi_conversation_cleanup" CHECK ("agentapi_conversations"."cleanup" in ('none', 'reserved', 'verified', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "agentapi_tool_events" (
	"conversation_id" text NOT NULL,
	"event_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"business_operation_id" text NOT NULL,
	"name" text NOT NULL,
	"args" jsonb NOT NULL,
	"success_payload" jsonb NOT NULL,
	"state" text NOT NULL,
	"result_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentapi_tool_events_conversation_id_event_id_pk" PRIMARY KEY("conversation_id","event_id"),
	CONSTRAINT "agentapi_tool_events_business_operation_id_unique" UNIQUE("business_operation_id"),
	CONSTRAINT "agentapi_tool_result_event" UNIQUE("conversation_id","result_event_id"),
	CONSTRAINT "agentapi_tool_identity" CHECK (length("agentapi_tool_events"."event_id") > 0 and "agentapi_tool_events"."business_operation_id" ~ '^[a-f0-9]{64}$'
        and ("agentapi_tool_events"."result_event_id" is null or length("agentapi_tool_events"."result_event_id") > 0)),
	CONSTRAINT "agentapi_tool_state" CHECK ("agentapi_tool_events"."state" in ('sending', 'sent', 'outcome_unknown')),
	CONSTRAINT "agentapi_tool_shape" CHECK ((jsonb_typeof("agentapi_tool_events"."args") = 'object'
        and jsonb_typeof("agentapi_tool_events"."success_payload") = 'object'
        and case "agentapi_tool_events"."name"
          when 'submit_material_batch' then
            jsonb_typeof("agentapi_tool_events"."args"->'operationId') = 'string'
            and length("agentapi_tool_events"."args"->>'operationId') > 0
            and jsonb_typeof("agentapi_tool_events"."args"->'evaluationNodeId') = 'string'
            and length("agentapi_tool_events"."args"->>'evaluationNodeId') > 0
            and jsonb_typeof("agentapi_tool_events"."args"->'personIds') = 'array'
            and jsonb_typeof("agentapi_tool_events"."args"->'projectId') in ('string', 'null')
            and jsonb_typeof("agentapi_tool_events"."args"->'text') = 'string'
            and jsonb_typeof("agentapi_tool_events"."args"->'files') = 'array'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'batchId') = 'string'
            and length("agentapi_tool_events"."success_payload"->>'batchId') > 0
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'revision') = 'number'
            and ("agentapi_tool_events"."success_payload"->>'revision') ~ '^[1-9][0-9]*$'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'evaluationNodeId') = 'string'
            and "agentapi_tool_events"."success_payload"->>'evaluationNodeId' = "agentapi_tool_events"."args"->>'evaluationNodeId'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'personIds') = 'array'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'files') = 'array'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'counts') = 'object'
          when 'person_brief' then
            jsonb_typeof("agentapi_tool_events"."args"->'id') = 'string'
            and length("agentapi_tool_events"."args"->>'id') > 0
            and "agentapi_tool_events"."success_payload"->>'role' in ('manager', 'hr', 'mentor')
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'person') = 'object'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'person'->'id') = 'string'
            and "agentapi_tool_events"."success_payload"->'person'->>'id' = "agentapi_tool_events"."args"->>'id'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'projectLoad') = 'object'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'recentFacts') = 'object'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'capabilityLines') = 'object'
          when 'draft_requirement' then
            jsonb_typeof("agentapi_tool_events"."args"->'operationId') = 'string'
            and length(trim("agentapi_tool_events"."args"->>'operationId')) > 0
            and jsonb_typeof("agentapi_tool_events"."args"->'projectId') = 'string'
            and length(trim("agentapi_tool_events"."args"->>'projectId')) > 0
            and jsonb_typeof("agentapi_tool_events"."args"->'inputText') = 'string'
            and length(trim("agentapi_tool_events"."args"->>'inputText')) > 0
            and "agentapi_tool_events"."success_payload"->>'kind' = 'staffing_demand'
            and "agentapi_tool_events"."success_payload"->'schemaVersion' = '1'::jsonb
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'jobId') = 'string'
            and length("agentapi_tool_events"."success_payload"->>'jobId') > 0
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'revision') = 'number'
            and ("agentapi_tool_events"."success_payload"->>'revision') ~ '^[1-9][0-9]*$'
            and "agentapi_tool_events"."success_payload"->>'status' in ('queued', 'running', 'partial', 'awaiting_manual', 'failed', 'completed', 'cancelled')
            and ("agentapi_tool_events"."success_payload"->'result' = 'null'::jsonb or (
              jsonb_typeof("agentapi_tool_events"."success_payload"->'result') = 'object'
              and jsonb_typeof("agentapi_tool_events"."success_payload"->'result'->'projectId') = 'string'
              and "agentapi_tool_events"."success_payload"->'result'->>'projectId' = "agentapi_tool_events"."args"->>'projectId'))
          else false
        end) is true)
);
--> statement-breakpoint
CREATE TABLE "agentapi_turns" (
	"conversation_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"input_digest" text NOT NULL,
	"state" text NOT NULL,
	"user_event_id" text,
	"answer" text,
	"nature" text DEFAULT 'ai_suggestion' NOT NULL,
	"polls" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentapi_turns_conversation_id_operation_id_pk" PRIMARY KEY("conversation_id","operation_id"),
	CONSTRAINT "agentapi_turn_ordinal" UNIQUE("conversation_id","ordinal"),
	CONSTRAINT "agentapi_turn_user_event" UNIQUE("conversation_id","user_event_id"),
	CONSTRAINT "agentapi_turn_identity" CHECK (length("agentapi_turns"."operation_id") between 1 and 200 and "agentapi_turns"."ordinal" > 0
        and "agentapi_turns"."input_digest" ~ '^[a-f0-9]{64}$'
        and ("agentapi_turns"."user_event_id" is null or length("agentapi_turns"."user_event_id") > 0)),
	CONSTRAINT "agentapi_turn_state" CHECK ("agentapi_turns"."state" in ('reserved', 'submitted', 'complete', 'outcome_unknown', 'failed')),
	CONSTRAINT "agentapi_turn_answer" CHECK (("agentapi_turns"."answer" is null or ("agentapi_turns"."state" = 'complete' and length("agentapi_turns"."answer") <= 65536))
        and "agentapi_turns"."nature" = 'ai_suggestion'),
	CONSTRAINT "agentapi_turn_polls" CHECK ("agentapi_turns"."polls" between 0 and 120)
);
--> statement-breakpoint
ALTER TABLE "agentapi_conversations" ADD CONSTRAINT "agentapi_conversations_binding_id_entry_agent_api_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."entry_agent_api_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentapi_tool_events" ADD CONSTRAINT "agentapi_tool_turn" FOREIGN KEY ("conversation_id","operation_id") REFERENCES "public"."agentapi_turns"("conversation_id","operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentapi_turns" ADD CONSTRAINT "agentapi_turns_conversation_id_agentapi_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agentapi_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agentapi_turn_incomplete" ON "agentapi_turns" USING btree ("conversation_id") WHERE "agentapi_turns"."state" <> 'complete';