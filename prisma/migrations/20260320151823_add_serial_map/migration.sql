/*
  Warnings:

  - You are about to drop the column `serialNumber` on the `inventory_item` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[serial_number]` on the table `inventory_item` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `inventory_item_serialNumber_key` ON `inventory_item`;

-- AlterTable
ALTER TABLE `inventory_item` DROP COLUMN `serialNumber`,
    ADD COLUMN `serial_number` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `inventory_item_serial_number_key` ON `inventory_item`(`serial_number`);
