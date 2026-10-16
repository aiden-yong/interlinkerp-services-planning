CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organisation_id" varchar(64) NOT NULL,
	"recipient_ref" varchar(64),
	"recipient_email" varchar(254),
	"kind" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"link" varchar(500) NOT NULL,
	"shift_id" uuid,
	"outbox_id" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"email_attempts" smallint DEFAULT 0 NOT NULL,
	"email_next_at" timestamp with time zone NOT NULL,
	"email_error" text,
	CONSTRAINT "notifications_one_recipient" CHECK (("notifications"."recipient_ref" is null) <> ("notifications"."recipient_email" is null))
);
--> statement-breakpoint
ALTER TABLE "employee_directory" ADD COLUMN "email" varchar(254);--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "audience" varchar(16) DEFAULT 'employee' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD COLUMN "give_up_mode" varchar(16) DEFAULT 'switch' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD COLUMN "unassign_window_days" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "switch_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notifications_ref_idx" ON "notifications" USING btree ("organisation_id","recipient_ref","created_at");--> statement-breakpoint
CREATE INDEX "notifications_email_idx" ON "notifications" USING btree ("organisation_id","recipient_email","created_at");--> statement-breakpoint
CREATE INDEX "notifications_email_due_idx" ON "notifications" USING btree ("organisation_id","email_next_at") WHERE "notifications"."emailed_at" is null;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_audience_valid" CHECK ("notification_outbox"."audience" in ('employee', 'managers'));--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD CONSTRAINT "organisation_settings_give_up_mode_valid" CHECK ("organisation_settings"."give_up_mode" in ('switch', 'unassign'));--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD CONSTRAINT "organisation_settings_window_range" CHECK ("organisation_settings"."unassign_window_days" between 0 and 60);