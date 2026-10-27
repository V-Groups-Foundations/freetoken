CREATE TABLE "generated_images" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"prompt" text NOT NULL,
	"kind" text NOT NULL,
	"engine" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "images_user_time" ON "generated_images" USING btree ("user_id","created_at");