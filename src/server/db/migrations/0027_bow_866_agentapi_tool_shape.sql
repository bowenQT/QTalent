ALTER TABLE "agentapi_tool_events" DROP CONSTRAINT "agentapi_tool_shape";--> statement-breakpoint
ALTER TABLE "agentapi_tool_events" ADD CONSTRAINT "agentapi_tool_shape" CHECK ((jsonb_typeof("agentapi_tool_events"."args") = 'object'
        and jsonb_typeof("agentapi_tool_events"."success_payload") = 'object'
        and case "agentapi_tool_events"."name"
          when 'submit_material_batch' then
            jsonb_typeof("agentapi_tool_events"."args"->'operationId') = 'string'
            and length("agentapi_tool_events"."args"->>'operationId') > 0
            and (
              (jsonb_typeof("agentapi_tool_events"."args"->'evaluationNodeId') = 'string'
                and length("agentapi_tool_events"."args"->>'evaluationNodeId') > 0
                and "agentapi_tool_events"."success_payload"->>'evaluationNodeId' = "agentapi_tool_events"."args"->>'evaluationNodeId')
              or ("agentapi_tool_events"."args"->'evaluationNodeId' is null
                and "agentapi_tool_events"."args"->>'text' = ''
                and case when jsonb_typeof("agentapi_tool_events"."args"->'files') = 'array'
                  then jsonb_array_length("agentapi_tool_events"."args"->'files') > 0 else false end
                and length("agentapi_tool_events"."success_payload"->>'evaluationNodeId') > 0)
            )
            and jsonb_typeof("agentapi_tool_events"."args"->'personIds') = 'array'
            and jsonb_typeof("agentapi_tool_events"."args"->'projectId') in ('string', 'null')
            and jsonb_typeof("agentapi_tool_events"."args"->'text') = 'string'
            and jsonb_typeof("agentapi_tool_events"."args"->'files') = 'array'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'batchId') = 'string'
            and length("agentapi_tool_events"."success_payload"->>'batchId') > 0
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'revision') = 'number'
            and ("agentapi_tool_events"."success_payload"->>'revision') ~ '^[1-9][0-9]*$'
            and jsonb_typeof("agentapi_tool_events"."success_payload"->'evaluationNodeId') = 'string'
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
        end) is true);