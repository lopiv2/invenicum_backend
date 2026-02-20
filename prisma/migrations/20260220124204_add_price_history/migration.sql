-- CreateTable
CREATE TABLE `PriceHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `price` DOUBLE NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'EUR',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `inventoryItemId` INTEGER NOT NULL,

    INDEX `PriceHistory_inventoryItemId_idx`(`inventoryItemId`),
    INDEX `PriceHistory_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PriceHistory` ADD CONSTRAINT `PriceHistory_inventoryItemId_fkey` FOREIGN KEY (`inventoryItemId`) REFERENCES `inventory_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
