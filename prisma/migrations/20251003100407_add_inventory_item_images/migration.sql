-- CreateTable
CREATE TABLE `inventory_item_image` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `url` VARCHAR(191) NOT NULL,
    `alt_text` VARCHAR(191) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `inventory_item_id` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `inventory_item_image` ADD CONSTRAINT `inventory_item_image_inventory_item_id_fkey` FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
