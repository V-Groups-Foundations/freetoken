CREATE TABLE "training_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" jsonb NOT NULL,
	"change" text,
	"source" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"exercise" text NOT NULL,
	"kg" real DEFAULT 0 NOT NULL,
	"reps" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diet_profiles" ADD COLUMN "train_days" integer;--> statement-breakpoint
ALTER TABLE "diet_profiles" ADD COLUMN "session_minutes" integer;--> statement-breakpoint
ALTER TABLE "diet_profiles" ADD COLUMN "experience" text;--> statement-breakpoint
ALTER TABLE "diet_profiles" ADD COLUMN "equipment" text;--> statement-breakpoint
ALTER TABLE "diet_profiles" ADD COLUMN "injuries" text;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_plans_user" ON "training_plans" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "workout_sets_user_ex" ON "workout_sets" USING btree ("user_id","exercise","day");