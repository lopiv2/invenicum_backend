-- AlterTable
ALTER TABLE `inventory_item` ADD COLUMN `condition` VARCHAR(191) NOT NULL DEFAULT 'loose',
    ADD COLUMN `wishlisted` BOOLEAN NOT NULL DEFAULT false;
