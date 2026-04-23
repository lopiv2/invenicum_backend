-- AlterTable
ALTER TABLE `scraper` ADD COLUMN `container_id` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `scraper` ADD CONSTRAINT `scraper_container_id_fkey` FOREIGN KEY (`container_id`) REFERENCES `container`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
