CREATE TABLE "diet_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"pose" text DEFAULT 'front' NOT NULL,
	"data" "bytea" NOT NULL,
	"kg" real,
	"body_fat_low" real,
	"body_fat_high" real,
	"analysis" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diet_profiles" ADD COLUMN "activity" text;--> statement-breakpoint
ALTER TABLE "diet_profiles" ADD COLUMN "goal_weight_kg" real;--> statement-breakpoint
ALTER TABLE "diet_profiles" ADD COLUMN "photo_id" integer;--> statement-breakpoint
ALTER TABLE "diet_photos" ADD CONSTRAINT "diet_photos_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diet_photos_user_day" ON "diet_photos" USING btree ("user_id","day");