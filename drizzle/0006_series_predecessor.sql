ALTER TABLE "recurrences" ADD COLUMN "predecessor_id" uuid;--> statement-breakpoint
CREATE INDEX "recurrences_predecessor_idx" ON "recurrences" USING btree ("predecessor_id");