-- CreateTable
CREATE TABLE `user_theme_config` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `themeColor` VARCHAR(191) NOT NULL DEFAULT '#1A237E',
    `themeBrightness` VARCHAR(191) NOT NULL DEFAULT 'light',
    `userId` INTEGER NOT NULL,

    UNIQUE INDEX `user_theme_config_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_theme` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `primaryColor` VARCHAR(191) NOT NULL,
    `brightness` VARCHAR(191) NOT NULL DEFAULT 'light',
    `userId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_theme_config` ADD CONSTRAINT `user_theme_config_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_theme` ADD CONSTRAINT `custom_theme_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
