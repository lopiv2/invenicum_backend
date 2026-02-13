-- AlterTable
ALTER TABLE `user` ADD COLUMN `githubToken` TEXT NULL,
    ADD COLUMN `github_linked_at` DATETIME(3) NULL;
