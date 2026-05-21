/*
  Warnings:

  - You are about to drop the column `condition` on the `achievement` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `achievement` table. All the data in the column will be lost.
  - You are about to drop the column `target` on the `user_achievement_progress` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `user_achievement_progress` table. All the data in the column will be lost.
  - You are about to drop the `user_achievement` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `eventType` to the `achievement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `user_achievement_progress` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `user_achievement` DROP FOREIGN KEY `user_achievement_achievement_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_achievement` DROP FOREIGN KEY `user_achievement_user_id_fkey`;

-- AlterTable
ALTER TABLE `achievement` DROP COLUMN `condition`,
    DROP COLUMN `type`,
    ADD COLUMN `eventType` VARCHAR(191) NOT NULL,
    ADD COLUMN `extraConfig` JSON NULL,
    ADD COLUMN `requiredValue` INTEGER NULL,
    MODIFY `description` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `user_achievement_progress` DROP COLUMN `target`,
    DROP COLUMN `updatedAt`,
    ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `unlocked` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `unlocked_at` DATETIME(3) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL;

-- DropTable
DROP TABLE `user_achievement`;

-- CreateTable
CREATE TABLE `user_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 1,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_event_user_id_type_idx`(`user_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `achievement_sync` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `last_sync_at` DATETIME(3) NULL,

    UNIQUE INDEX `achievement_sync_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `user_achievement_progress_user_id_idx` ON `user_achievement_progress`(`user_id`);

-- AddForeignKey
ALTER TABLE `user_event` ADD CONSTRAINT `user_event_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `achievement_sync` ADD CONSTRAINT `achievement_sync_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
