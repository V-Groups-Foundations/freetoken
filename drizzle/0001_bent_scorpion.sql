CREATE TABLE "provider_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"limit_requests" integer,
	"remaining_requests" integer,
	"requests_reset_at" timestamp,
	"limit_tokens" integer,
	"remaining_tokens" integer,
	"tokens_reset_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_limits" ADD CONSTRAINT "provider_limits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_limits_user_model" ON "provider_limits" USING btree ("user_id","provider","model_id");