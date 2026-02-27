-- AlterTable
ALTER TABLE `alert` ADD COLUMN `end_date` DATETIME(3) NULL,
    ADD COLUMN `is_event` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `scheduled_at` DATETIME(3) NULL;
