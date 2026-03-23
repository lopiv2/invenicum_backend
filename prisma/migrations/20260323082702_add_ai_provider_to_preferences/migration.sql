-- AlterTable
ALTER TABLE `user_preferences` ADD COLUMN `ai_model` VARCHAR(191) NOT NULL DEFAULT 'gemini-3-flash-preview',
    ADD COLUMN `ai_provider` VARCHAR(191) NOT NULL DEFAULT 'gemini';
