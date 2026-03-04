/*
  Warnings:

  - You are about to drop the column `hasPendingPR` on the `plugin` table. All the data in the column will be lost.
  - You are about to drop the column `pendingVersion` on the `plugin` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `plugin` DROP COLUMN `hasPendingPR`,
    DROP COLUMN `pendingVersion`;
