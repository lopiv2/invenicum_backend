-- CreateTable
CREATE TABLE `report` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `format` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `filePath` TEXT NOT NULL,
    `fileSize` INTEGER NULL,
    `filters` JSON NULL,
    `container_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `is_downloaded` BOOLEAN NOT NULL DEFAULT false,

    INDEX `report_container_id_idx`(`container_id`),
    INDEX `report_user_id_idx`(`user_id`),
    INDEX `report_generated_at_idx`(`generated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `report` ADD CONSTRAINT `report_container_id_fkey` FOREIGN KEY (`container_id`) REFERENCES `Container`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report` ADD CONSTRAINT `report_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
