/*
  Warnings:

  - You are about to drop the column `image_url` on the `asset_type` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `asset_type` DROP COLUMN `image_url`;

-- CreateTable
CREATE TABLE `asset_type_image` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `url` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `alt_text` VARCHAR(191) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `asset_type_id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `asset_type_image` ADD CONSTRAINT `asset_type_image_asset_type_id_fkey` FOREIGN KEY (`asset_type_id`) REFERENCES `asset_type`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
