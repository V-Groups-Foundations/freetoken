CREATE TABLE "login_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"failed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_failures_email" ON "login_failures" USING btree ("email","failed_at");