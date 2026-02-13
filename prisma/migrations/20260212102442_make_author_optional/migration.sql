-- DropForeignKey
ALTER TABLE `plugin` DROP FOREIGN KEY `plugin_author_id_fkey`;

-- DropIndex
DROP INDEX `plugin_author_id_fkey` ON `plugin`;

-- AlterTable
ALTER TABLE `plugin` MODIFY `author_id` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `plugin` ADD CONSTRAINT `plugin_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
