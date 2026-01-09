-- CreateTable
CREATE TABLE `voucher_config` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `template` TEXT NOT NULL,
    `logoPath` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
