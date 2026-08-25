ALTER TABLE "cpr_data" ADD COLUMN "provider_symbol" text;--> statement-breakpoint
ALTER TABLE "cpr_data" ADD COLUMN "projected" boolean DEFAULT false NOT NULL;