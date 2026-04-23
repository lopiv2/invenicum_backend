-- CreateTable
CREATE TABLE `scraper` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `url_pattern` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scraper_field` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `xpath` VARCHAR(191) NOT NULL,
    `order` INTEGER NULL DEFAULT 0,
    `scraper_id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `scraper_field` ADD CONSTRAINT `scraper_field_scraper_id_fkey` FOREIGN KEY (`scraper_id`) REFERENCES `scraper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
