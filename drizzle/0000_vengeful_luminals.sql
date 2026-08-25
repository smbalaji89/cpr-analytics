CREATE TABLE "cpr_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" text NOT NULL,
	"instrument_symbol" text NOT NULL,
	"instrument_category" text NOT NULL,
	"trading_date" date NOT NULL,
	"source_date" date NOT NULL,
	"high" numeric(20, 4) NOT NULL,
	"low" numeric(20, 4) NOT NULL,
	"close" numeric(20, 4) NOT NULL,
	"pivot" numeric(20, 4) NOT NULL,
	"bc" numeric(20, 4) NOT NULL,
	"tc" numeric(20, 4) NOT NULL,
	"cpr_width" numeric(20, 4) NOT NULL,
	"cpr_width_percent" numeric(12, 6) NOT NULL,
	"points_classification" text NOT NULL,
	"percentage_classification" text NOT NULL,
	"overall_classification" text NOT NULL,
	"classification_basis" text NOT NULL,
	"inverted" boolean DEFAULT false NOT NULL,
	"r1" numeric(20, 4) NOT NULL,
	"r2" numeric(20, 4) NOT NULL,
	"r3" numeric(20, 4) NOT NULL,
	"r4" numeric(20, 4) NOT NULL,
	"r5" numeric(20, 4) NOT NULL,
	"s1" numeric(20, 4) NOT NULL,
	"s2" numeric(20, 4) NOT NULL,
	"s3" numeric(20, 4) NOT NULL,
	"s4" numeric(20, 4) NOT NULL,
	"s5" numeric(20, 4) NOT NULL,
	"data_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cpr_data_symbol_date_unq" ON "cpr_data" USING btree ("instrument_symbol","trading_date");--> statement-breakpoint
CREATE INDEX "cpr_data_symbol_idx" ON "cpr_data" USING btree ("instrument_symbol");--> statement-breakpoint
CREATE INDEX "cpr_data_trading_date_idx" ON "cpr_data" USING btree ("trading_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cpr_data_category_idx" ON "cpr_data" USING btree ("instrument_category");--> statement-breakpoint
CREATE INDEX "cpr_data_symbol_date_idx" ON "cpr_data" USING btree ("instrument_symbol","trading_date" DESC NULLS LAST);