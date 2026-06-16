CREATE TABLE "acconto_deductions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"final_invoice_id" uuid NOT NULL,
	"acconto_invoice_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"matter_id" uuid NOT NULL,
	"type" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"work_value_ore_at_run" bigint NOT NULL,
	"client_share_bips" integer,
	"proposed_amount_ore" bigint NOT NULL,
	"amount_ore" bigint NOT NULL,
	"prutning_ore" bigint,
	"invoice_id" uuid,
	"deducted_billing_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"period_from" timestamp with time zone,
	"period_to" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'appointment' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"matter_id" uuid,
	"visibility" text DEFAULT 'normal' NOT NULL,
	"mirror_to_outlook" boolean DEFAULT false NOT NULL,
	"outlook_event_id" text,
	"outlook_calendar_id" text,
	"mirror_status" text,
	"mirror_error" text,
	"mirror_last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conflict_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"search_term" text NOT NULL,
	"search_type" text NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_by_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_analysis_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"document_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"contact_type" text NOT NULL,
	"email" text,
	"phone" text,
	"org_number" text,
	"personal_number" text,
	"notes" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"accepted_contact_id" uuid
);
--> statement-breakpoint
CREATE TABLE "document_folders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"matter_id" uuid NOT NULL,
	"parent_id" uuid
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"content" text NOT NULL,
	"created_by_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"matter_id" uuid NOT NULL,
	"folder_id" uuid,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"title" text,
	"document_type" text,
	"summary" text,
	"analyzed_at" timestamp with time zone,
	"analysis_status" text,
	"analysis_model" text,
	"analysis_error" text
);
--> statement-breakpoint
CREATE TABLE "expected_receivables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"organization_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"description" text NOT NULL,
	"expected_amount" bigint NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"settled_amount" bigint,
	"settled_at" timestamp with time zone,
	"payment_reference" text,
	"recorded_by_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"amount" bigint NOT NULL,
	"description" text NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"invoice_id" uuid,
	"vat_rate" integer DEFAULT 2500 NOT NULL,
	"vat_included" boolean DEFAULT true NOT NULL,
	"kind" text DEFAULT 'EXPENSE' NOT NULL,
	"frozen_at" timestamp with time zone,
	"frozen_by_billing_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "invoice_dispatches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"message_id" text,
	"error" text,
	"recorded_by_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"matter_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"invoice_type" text DEFAULT 'STANDARD' NOT NULL,
	"invoice_number" text,
	"ocr_reference" text,
	"fortnox_id" text,
	"invoice_date" timestamp with time zone NOT NULL,
	"due_date" timestamp with time zone,
	"notes" text,
	"credited_invoice_id" uuid
);
--> statement-breakpoint
CREATE TABLE "matter_event_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"document_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"event_type" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"status" text DEFAULT 'PENDING' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"prefs" jsonb NOT NULL,
	"created_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "payment_plan_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"plan_id" uuid NOT NULL,
	"due_month" text NOT NULL,
	"type" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"monthly_amount" bigint NOT NULL,
	"day_of_month" integer NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"note" text,
	"reference" text,
	"recorded_by_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"organization_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"date" text NOT NULL,
	"time" text NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'TODO' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"matter_id" uuid
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"minutes" integer NOT NULL,
	"description" text NOT NULL,
	"hourly_rate" integer NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"invoice_id" uuid,
	"frozen_at" timestamp with time zone,
	"frozen_by_billing_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"key" text NOT NULL,
	"prefs" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "write_offs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"written_off_at" timestamp with time zone NOT NULL,
	"reason" text,
	"recorded_by_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE INDEX "billing_runs_matter_idx" ON "billing_runs" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "calendar_events_user_idx" ON "calendar_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "doc_analysis_suggestions_doc_idx" ON "document_analysis_suggestions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_folders_matter_idx" ON "document_folders" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "documents_matter_idx" ON "documents" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "expected_receivables_matter_idx" ON "expected_receivables" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "expenses_matter_idx" ON "expenses" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "invoice_dispatches_invoice_idx" ON "invoice_dispatches" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_matter_idx" ON "invoices" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "matter_event_suggestions_doc_idx" ON "matter_event_suggestions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "payment_plan_reminders_plan_idx" ON "payment_plan_reminders" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "payment_plans_invoice_idx" ON "payment_plans" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "service_notes_matter_idx" ON "service_notes" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "tasks_user_idx" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "time_entries_matter_idx" ON "time_entries" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "user_preferences_user_idx" ON "user_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "write_offs_invoice_idx" ON "write_offs" USING btree ("invoice_id");