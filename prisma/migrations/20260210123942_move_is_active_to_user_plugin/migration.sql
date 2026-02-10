/*
  Warnings:

  - You are about to drop the column `is_active` on the `plugin` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `plugin` DROP COLUMN `is_active`;

-- AlterTable
ALTER TABLE `user_plugin` ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true;
