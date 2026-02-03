-- Migration: Add custom_name to phone_numbers and create message_templates table
-- Created: 2025

-- Add custom_name column to phone_numbers table
ALTER TABLE phone_numbers
ADD COLUMN IF NOT EXISTS custom_name TEXT;

-- Create message_templates table
CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  message_template TEXT NOT NULL,
  description TEXT,
  is_favorite BOOLEAN DEFAULT false,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT message_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Create index on workspace_id for faster queries
CREATE INDEX IF NOT EXISTS idx_message_templates_workspace_id ON message_templates(workspace_id);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_message_templates_created_at ON message_templates(created_at DESC);

-- Add RLS (Row Level Security) policies
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- Allow users to view templates in their workspace
CREATE POLICY "Users can view templates in their workspace"
ON message_templates FOR SELECT
USING (true);

-- Allow users to insert templates in their workspace
CREATE POLICY "Users can create templates in their workspace"
ON message_templates FOR INSERT
WITH CHECK (true);

-- Allow users to update templates in their workspace
CREATE POLICY "Users can update templates in their workspace"
ON message_templates FOR UPDATE
USING (true);

-- Allow users to delete templates in their workspace
CREATE POLICY "Users can delete templates in their workspace"
ON message_templates FOR DELETE
USING (true);

-- Add comment to custom_name column
COMMENT ON COLUMN phone_numbers.custom_name IS 'Custom name/label for the phone number (e.g., "California Office", "Florida Branch")';

-- Add comments to message_templates table
COMMENT ON TABLE message_templates IS 'Reusable message templates for campaigns';
COMMENT ON COLUMN message_templates.name IS 'Template name for identification';
COMMENT ON COLUMN message_templates.message_template IS 'The template content with placeholders like {name}, {phone}, etc.';
COMMENT ON COLUMN message_templates.description IS 'Optional description of when to use this template';
COMMENT ON COLUMN message_templates.is_favorite IS 'Mark as favorite for quick access';
