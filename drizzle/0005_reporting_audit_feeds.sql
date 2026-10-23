CREATE TABLE "audit_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organisation_id" varchar(64) NOT NULL,
	"shift_id" uuid NOT NULL,
	"action" varchar(24) NOT NULL,
	"actor" varchar(254),
	"actor_kind" varchar(8) NOT NULL,
	"changes" jsonb,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_entries_action_valid" CHECK ("audit_entries"."action" in ('created', 'changed', 'published', 'deleted', 'restored', 'split', 'copied', 'generated', 'auto_planned', 'claimed', 'switch_requested', 'switch_cancelled', 'taken_over', 'unassigned')),
	CONSTRAINT "audit_entries_actor_kind_valid" CHECK ("audit_entries"."actor_kind" in ('manager', 'employee', 'system'))
);
--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"organisation_id" varchar(64) NOT NULL,
	"employee_ref" varchar(64) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "calendar_feeds_organisation_id_employee_ref_pk" PRIMARY KEY("organisation_id","employee_ref"),
	CONSTRAINT "calendar_feeds_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD COLUMN "reminder_lead_minutes" smallint DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "audit_entries_shift_idx" ON "audit_entries" USING btree ("organisation_id","shift_id","at");--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD CONSTRAINT "organisation_settings_reminder_lead_valid" CHECK ("organisation_settings"."reminder_lead_minutes" in (0, 30, 60, 120, 240, 720, 1440));
--> statement-breakpoint
-- back-fill (D18): history for shifts made before M4
INSERT INTO "audit_entries" ("organisation_id", "shift_id", "action", "actor", "actor_kind", "at")
SELECT "organisation_id", "id", 'created', "created_by", 'manager', "created_at" FROM "shifts";--> statement-breakpoint
INSERT INTO "audit_entries" ("organisation_id", "shift_id", "action", "actor", "actor_kind", "at")
SELECT "organisation_id", "id", 'published', NULL, 'system', "published_at" FROM "shifts" WHERE "published_at" IS NOT NULL;--> statement-breakpoint
INSERT INTO "audit_entries" ("organisation_id", "shift_id", "action", "actor", "actor_kind", "at")
SELECT "organisation_id", "id", 'deleted', "deleted_by", 'manager', "deleted_at" FROM "shifts" WHERE "deleted_at" IS NOT NULL;
