CREATE TABLE "job_runs" (
	"organisation_id" varchar(64) NOT NULL,
	"job" varchar(40) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "job_runs_organisation_id_job_pk" PRIMARY KEY("organisation_id","job")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"organisation_id" varchar(64) NOT NULL,
	"bucket" varchar(200) NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_organisation_id_bucket_pk" PRIMARY KEY("organisation_id","bucket")
);
