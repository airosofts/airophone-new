-- Migration: Rename 'name' column to 'business_name' in contacts table
-- Created: 2025

-- Rename name column to business_name
ALTER TABLE contacts
RENAME COLUMN name TO business_name;

-- Add comment to business_name column
COMMENT ON COLUMN contacts.business_name IS 'Business or person name for the contact';
