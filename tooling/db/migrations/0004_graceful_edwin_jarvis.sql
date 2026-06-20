ALTER TABLE "documents" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "document_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;