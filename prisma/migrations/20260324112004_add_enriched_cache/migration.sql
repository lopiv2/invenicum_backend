-- AlterTable
ALTER TABLE `api_mapper` ADD COLUMN `locale` VARCHAR(191) NOT NULL DEFAULT 'es';

-- CreateTable
CREATE TABLE `enriched_cache` (
    `id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `query` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(191) NOT NULL,
    `data` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `enriched_cache_source_query_locale_key`(`source`, `query`, `locale`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
