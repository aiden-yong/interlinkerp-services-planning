CREATE TABLE "email_opt_outs" (
	"organisation_id" varchar(64) NOT NULL,
	"recipient" varchar(260) NOT NULL,
	"kind" varchar(40) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_opt_outs_organisation_id_recipient_kind_pk" PRIMARY KEY("organisation_id","recipient","kind")
);
