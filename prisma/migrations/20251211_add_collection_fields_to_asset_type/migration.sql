-- Migration: Add collection fields to asset_type table
-- File: prisma/migrations/20251211_add_collection_fields_to_asset_type/migration.sql

ALTER TABLE `asset_type` 
ADD COLUMN `possession_field_id` INT NULL,
ADD COLUMN `desired_field_id` INT NULL;
