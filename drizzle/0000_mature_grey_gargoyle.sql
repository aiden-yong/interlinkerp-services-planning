CREATE TABLE "employee_directory" (
	"organisation_id" varchar(64) NOT NULL,
	"employee_ref" varchar(64) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"photo_url" varchar(500),
	"department_id" varchar(64),
	"department_name" varchar(160),
	"status" varchar(32) NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "employee_directory_organisation_id_employee_ref_pk" PRIMARY KEY("organisation_id","employee_ref")
);
--> statement-breakpoint
CREATE TABLE "employee_profiles" (
	"organisation_id" varchar(64) NOT NULL,
	"employee_ref" varchar(64) NOT NULL,
	"default_role_id" uuid,
	"timezone" varchar(64),
	"working_hours" jsonb,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "employee_profiles_organisation_id_employee_ref_pk" PRIMARY KEY("organisation_id","employee_ref")
);
--> statement-breakpoint
CREATE TABLE "employee_roles" (
	"organisation_id" varchar(64) NOT NULL,
	"employee_ref" varchar(64) NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "employee_roles_organisation_id_employee_ref_role_id_pk" PRIMARY KEY("organisation_id","employee_ref","role_id")
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organisation_id" varchar(64) NOT NULL,
	"kind" varchar(40) NOT NULL,
	"employee_ref" varchar(64),
	"subject_id" uuid,
	"payload" jsonb NOT NULL,
	"deliver_after" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_settings" (
	"organisation_id" varchar(64) PRIMARY KEY NOT NULL,
	"country_code" char(2),
	"region_code" varchar(10),
	"timezone" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planning_managers" (
	"organisation_id" varchar(64) NOT NULL,
	"email" varchar(254) NOT NULL,
	"granted_by" varchar(254) NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "planning_managers_organisation_id_email_pk" PRIMARY KEY("organisation_id","email")
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" varchar(64) NOT NULL,
	"holiday_date" date NOT NULL,
	"name" varchar(160) NOT NULL,
	"source" varchar(16) NOT NULL,
	"provider_key" varchar(160),
	"edited" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "public_holidays_source_valid" CHECK ("public_holidays"."source" in ('manual', 'provider'))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" varchar(64) NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" char(7) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" varchar(64) NOT NULL,
	"employee_ref" varchar(64),
	"role_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"break_minutes" smallint DEFAULT 0 NOT NULL,
	"allocated_percent" smallint DEFAULT 100 NOT NULL,
	"note" text,
	"state" varchar(16) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"conflict_acknowledged_by" varchar(254),
	"conflict_acknowledged_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" varchar(254) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" varchar(254),
	CONSTRAINT "shifts_end_after_start" CHECK ("shifts"."end_at" > "shifts"."start_at"),
	CONSTRAINT "shifts_percent_range" CHECK ("shifts"."allocated_percent" between 1 and 100),
	CONSTRAINT "shifts_break_non_negative" CHECK ("shifts"."break_minutes" >= 0),
	CONSTRAINT "shifts_state_valid" CHECK ("shifts"."state" in ('draft', 'published'))
);
--> statement-breakpoint
CREATE TABLE "unavailabilities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" varchar(64) NOT NULL,
	"employee_ref" varchar(64) NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" varchar(200) DEFAULT '' NOT NULL,
	"created_by" varchar(254) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "unavailabilities_end_after_start" CHECK ("unavailabilities"."end_at" > "unavailabilities"."start_at")
);
--> statement-breakpoint
CREATE INDEX "employee_roles_role_idx" ON "employee_roles" USING btree ("organisation_id","role_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" USING btree ("organisation_id","deliver_after") WHERE "notification_outbox"."delivered_at" is null and "notification_outbox"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "notification_outbox_subject_idx" ON "notification_outbox" USING btree ("organisation_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_holidays_provider_key" ON "public_holidays" USING btree ("organisation_id","provider_key");--> statement-breakpoint
CREATE INDEX "public_holidays_date_idx" ON "public_holidays" USING btree ("organisation_id","holiday_date");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_lower_name_key" ON "roles" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE INDEX "shifts_live_time_idx" ON "shifts" USING btree ("organisation_id","start_at","end_at") WHERE "shifts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "shifts_live_employee_idx" ON "shifts" USING btree ("organisation_id","employee_ref","start_at") WHERE "shifts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "unavailabilities_employee_idx" ON "unavailabilities" USING btree ("organisation_id","employee_ref","start_at");--> statement-breakpoint
CREATE INDEX "unavailabilities_time_idx" ON "unavailabilities" USING btree ("organisation_id","start_at");