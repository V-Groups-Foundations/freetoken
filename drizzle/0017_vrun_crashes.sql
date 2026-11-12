CREATE TABLE "vrun_crashes" (
	"id" serial PRIMARY KEY NOT NULL,
	"signature" text NOT NULL,
	"version" text NOT NULL,
	"os" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vrun_crashes_signature" ON "vrun_crashes" USING btree ("signature");--> statement-breakpoint
CREATE INDEX "vrun_crashes_last" ON "vrun_crashes" USING btree ("last_seen");