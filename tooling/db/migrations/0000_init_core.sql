CREATE TABLE "change_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"row_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"op" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_type" text DEFAULT 'PERSON' NOT NULL,
	"personal_number" text,
	"org_number" text,
	"email" text,
	"phone" text,
	"address" text,
	"notes" text,
	"parent_id" uuid
);
--> statement-breakpoint
CREATE TABLE "matter_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"matter_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "matters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"organization_id" uuid NOT NULL,
	"matter_number" text NOT NULL,
	"responsible_lawyer_id" uuid,
	"court_case_number" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"matter_type" text,
	"payment_method" text DEFAULT 'PENDING' NOT NULL,
	"payment_method_note" text,
	"payment_method_decided_at" timestamp with time zone,
	"is_taxe_arende" boolean DEFAULT false NOT NULL,
	"taxa_level" integer,
	"taxa_huvudforhandling_min" integer,
	"taxa_has_f_tax" boolean DEFAULT false NOT NULL,
	"taxa_huf_start" timestamp with time zone,
	"radgivning_betald_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "offices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"is_main" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"org_number" text,
	"address" text,
	"phone" text,
	"email" text,
	"bankgiro" text,
	"logo_path" text,
	"azure_tenant_id" text,
	"ledger_account_map" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"role" text DEFAULT 'LAWYER' NOT NULL,
	"matter_number_prefix" text,
	"hourly_rate" integer,
	"mileage_rate" integer,
	"active" boolean DEFAULT true NOT NULL,
	"password_hash" text,
	"azure_oid" text,
	"oidc_subject" text,
	"oidc_issuer" text,
	"last_login_at" timestamp with time zone,
	"public_keys" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "change_log_org_seq_idx" ON "change_log" USING btree ("organization_id","seq");--> statement-breakpoint
CREATE INDEX "contacts_org_idx" ON "contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "matter_contacts_matter_idx" ON "matter_contacts" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "matters_org_idx" ON "matters" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");