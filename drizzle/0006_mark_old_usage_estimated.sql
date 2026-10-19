-- Before stream_options.include_usage was sent, streamed replies from most providers carried no token
-- counts and FreeToken stored a characters/4 guess. Groq always reported real counts; for the rest the
-- old rows can't be told apart, so they're marked estimated rather than passed off as measured.
UPDATE "usage_events" SET "estimated" = true WHERE "provider" <> 'groq' AND "status" = 'ok' AND "prompt_tokens" + "completion_tokens" > 0;
