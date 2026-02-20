/*
  Warnings:

  - A unique constraint covering the columns `[barcode]` on the table `inventory_item` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `inventory_item` ADD COLUMN `barcode` VARCHAR(191) NULL,
    ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'EUR',
    ADD COLUMN `last_price_update` DATETIME(3) NULL,
    ADD COLUMN `market_value` DOUBLE NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX `inventory_item_barcode_key` ON `inventory_item`(`barcode`);
