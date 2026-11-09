CREATE TABLE "diet_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"meal" text NOT NULL,
	"name" text NOT NULL,
	"kcal" real NOT NULL,
	"protein" real DEFAULT 0 NOT NULL,
	"fat" real DEFAULT 0 NOT NULL,
	"carbs" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diet_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"provider" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diet_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sex" text,
	"age" integer,
	"height_cm" real,
	"goal" text,
	"calories" integer,
	"protein" integer,
	"fat" integer,
	"carbs" integer,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diet_weights" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"kg" real NOT NULL,
	CONSTRAINT "diet_weights_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "diet_entries" ADD CONSTRAINT "diet_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diet_messages" ADD CONSTRAINT "diet_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diet_profiles" ADD CONSTRAINT "diet_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diet_weights" ADD CONSTRAINT "diet_weights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diet_entries_user_day" ON "diet_entries" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "diet_messages_user" ON "diet_messages" USING btree ("user_id","id");