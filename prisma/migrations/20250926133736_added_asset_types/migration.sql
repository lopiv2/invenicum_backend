-- CreateTable
CREATE TABLE `asset_type` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `image_url` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `containerId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_field_definition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `is_required` BOOLEAN NOT NULL DEFAULT false,
    `data_list_id` INTEGER NULL,
    `asset_type_id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `asset_type` ADD CONSTRAINT `asset_type_containerId_fkey` FOREIGN KEY (`containerId`) REFERENCES `Container`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_field_definition` ADD CONSTRAINT `custom_field_definition_asset_type_id_fkey` FOREIGN KEY (`asset_type_id`) REFERENCES `asset_type`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
