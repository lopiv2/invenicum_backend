/*
  Warnings:

  - A unique constraint covering the columns `[serialNumber]` on the table `inventory_item` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `inventory_item` ADD COLUMN `serialNumber` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `inventory_item_serialNumber_key` ON `inventory_item`(`serialNumber`);
