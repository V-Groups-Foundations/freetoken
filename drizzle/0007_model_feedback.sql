CREATE TABLE "model_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"task" text NOT NULL,
	"good" boolean NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "task" text;--> statement-breakpoint
ALTER TABLE "model_feedback" ADD CONSTRAINT "model_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_user_task_time" ON "model_feedback" USING btree ("user_id","task","created_at");