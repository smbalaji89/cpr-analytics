ALTER TABLE "cpr_data" ADD COLUMN "classification_method" text NOT NULL;--> statement-breakpoint
ALTER TABLE "cpr_data" ADD COLUMN "resolved_method" text;--> statement-breakpoint
ALTER TABLE "cpr_data" ADD COLUMN "methods_agree" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "cpr_data_overall_classification_idx" ON "cpr_data" USING btree ("overall_classification");