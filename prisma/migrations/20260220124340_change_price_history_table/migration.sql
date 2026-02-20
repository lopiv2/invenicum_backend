/*
  Warnings:

  - You are about to drop the `pricehistory` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `pricehistory` DROP FOREIGN KEY `PriceHistory_inventoryItemId_fkey`;

-- DropTable
DROP TABLE `pricehistory`;

-- CreateTable
CREATE TABLE `price_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `price` DOUBLE NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'EUR',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `inventoryItemId` INTEGER NOT NULL,

    INDEX `price_history_inventoryItemId_idx`(`inventoryItemId`),
    INDEX `price_history_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `price_history` ADD CONSTRAINT `price_history_inventoryItemId_fkey` FOREIGN KEY (`inventoryItemId`) REFERENCES `inventory_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
