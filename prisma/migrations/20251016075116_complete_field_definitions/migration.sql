-- AlterTable
ALTER TABLE `custom_field_definition` ADD COLUMN `is_countable` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `is_summable` BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE `custom_field_definition` ADD CONSTRAINT `custom_field_definition_data_list_id_fkey` FOREIGN KEY (`data_list_id`) REFERENCES `data_list`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
