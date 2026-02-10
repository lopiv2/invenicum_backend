-- CreateTable
CREATE TABLE `plugin` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `slot` VARCHAR(191) NOT NULL,
    `ui` JSON NOT NULL,
    `is_public` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_plugin` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `user_id` INTEGER NOT NULL,
    `plugin_id` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `user_plugin_user_id_plugin_id_key`(`user_id`, `plugin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_plugin` ADD CONSTRAINT `user_plugin_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_plugin` ADD CONSTRAINT `user_plugin_plugin_id_fkey` FOREIGN KEY (`plugin_id`) REFERENCES `plugin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
