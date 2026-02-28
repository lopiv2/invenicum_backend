-- AlterTable
ALTER TABLE `user_preferences` ADD COLUMN `alert_loan_reminders` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `alert_maintenance` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `alert_overdue_loans` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `alert_pre_sales` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `alert_price_change` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `alert_stock_low` BOOLEAN NOT NULL DEFAULT true;
