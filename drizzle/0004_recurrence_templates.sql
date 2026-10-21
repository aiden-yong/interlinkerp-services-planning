CREATE TABLE "recurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" varchar(64) NOT NULL,
	"interval" smallint NOT NULL,
	"unit" varchar(8) NOT NULL,
	"ends" varchar(8) NOT NULL,
	"until_date" date,
	"occurrence_count" smallint,
	"timezone" varchar(64) NOT NULL,
	"first_start_local" timestamp NOT NULL,
	"duration_minutes" integer NOT NULL,
	"employee_ref" varchar(64),
	"role_id" uuid,
	"break_minutes" smallint DEFAULT 0 NOT NULL,
	"allocated_percent" smallint DEFAULT 100 NOT NULL,
	"note" text,
	"last_index" integer,
	"generated_until" timestamp with time zone NOT NULL,
	"created_by" varchar(254) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recurrences_interval_range" CHECK ("recurrences"."interval" between 1 and 99),
	CONSTRAINT "recurrences_unit_valid" CHECK ("recurrences"."unit" in ('day', 'week', 'month')),
	CONSTRAINT "recurrences_ends_valid" CHECK ("recurrences"."ends" in ('never', 'on', 'after')),
	CONSTRAINT "recurrences_occurrence_count_range" CHECK ("recurrences"."occurrence_count" between 1 and 999),
	CONSTRAINT "recurrences_duration_range" CHECK ("recurrences"."duration_minutes" between 1 and 10080),
	CONSTRAINT "recurrences_break_non_negative" CHECK ("recurrences"."break_minutes" >= 0),
	CONSTRAINT "recurrences_percent_range" CHECK ("recurrences"."allocated_percent" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" varchar(64) NOT NULL,
	"name" varchar(80) NOT NULL,
	"role_id" uuid,
	"start_time" char(5) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"break_minutes" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shift_templates_duration_range" CHECK ("shift_templates"."duration_minutes" between 1 and 10080),
	CONSTRAINT "shift_templates_break_non_negative" CHECK ("shift_templates"."break_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD COLUMN "recurrence_horizon_months" smallint DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "recurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "recurrence_index" integer;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "recurrence_detached" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "copied_from" uuid;--> statement-breakpoint
CREATE INDEX "recurrences_org_idx" ON "recurrences" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_templates_org_lower_name_key" ON "shift_templates" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_recurrence_step_key" ON "shifts" USING btree ("organisation_id","recurrence_id","recurrence_index") WHERE "shifts"."recurrence_id" is not null;--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD CONSTRAINT "organisation_settings_recurrence_horizon_range" CHECK ("organisation_settings"."recurrence_horizon_months" between 1 and 24);