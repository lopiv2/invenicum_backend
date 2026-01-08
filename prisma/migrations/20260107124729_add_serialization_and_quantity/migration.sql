-- AlterTable
ALTER TABLE `asset_type` ADD COLUMN `is_serialized` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `inventory_item` ADD COLUMN `quantity` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `loan` ADD COLUMN `quantity` INTEGER NOT NULL DEFAULT 1;
