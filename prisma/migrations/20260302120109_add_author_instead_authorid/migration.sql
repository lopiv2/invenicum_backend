/*
  Warnings:

  - You are about to drop the column `author_id` on the `plugin` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE `plugin` DROP FOREIGN KEY `plugin_author_id_fkey`;

-- DropIndex
DROP INDEX `plugin_author_id_fkey` ON `plugin`;

-- AlterTable
ALTER TABLE `plugin` DROP COLUMN `author_id`,
    ADD COLUMN `author_handle` VARCHAR(191) NULL;
