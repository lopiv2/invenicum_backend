-- CreateTable
CREATE TABLE `cross_toon_config` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `image_path` VARCHAR(191) NOT NULL,
    `speed` INTEGER NOT NULL DEFAULT 8,
    `direction` VARCHAR(191) NOT NULL DEFAULT 'alternate',
    `frequency` INTEGER NOT NULL DEFAULT 600,
    `zone` VARCHAR(191) NOT NULL DEFAULT 'bottom',
    `image_size` DOUBLE NOT NULL DEFAULT 80,
    `turn_mode` VARCHAR(191) NOT NULL DEFAULT 'on',
    `turn_min_delay` INTEGER NOT NULL DEFAULT 2,
    `turn_max_delay` INTEGER NOT NULL DEFAULT 6,
    `max_turns` INTEGER NOT NULL DEFAULT 3,
    `animation_fps` INTEGER NOT NULL DEFAULT 60,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `cross_toon_config_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `cross_toon_config` ADD CONSTRAINT `cross_toon_config_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
