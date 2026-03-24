/*
  Warnings:

  - You are about to drop the `apimapper` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE `apimapper`;

-- CreateTable
CREATE TABLE `api_mapper` (
    `id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `structureHash` VARCHAR(191) NOT NULL,
    `mappingJson` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `api_mapper_structureHash_key`(`structureHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
