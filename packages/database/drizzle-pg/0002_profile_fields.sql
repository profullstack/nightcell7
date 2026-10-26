CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text,
	"first_name" text,
	"last_name" text,
	"company_domain" text,
	"job_title" text,
	"linkedin_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_profiles_email" ON "user_profiles" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "user_profiles_company_domain" ON "user_profiles" USING btree ("company_domain");