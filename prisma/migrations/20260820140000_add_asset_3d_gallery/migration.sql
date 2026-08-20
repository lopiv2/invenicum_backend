ALTER TABLE `asset_type`
  ADD COLUMN `asset_kind` VARCHAR(191) NOT NULL DEFAULT 'standard';

CREATE TABLE `inventory_item_model_3d` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `source_type` VARCHAR(191) NOT NULL DEFAULT 'upload',
  `relative_path` VARCHAR(191) NOT NULL,
  `url` VARCHAR(191) NOT NULL,
  `filename` VARCHAR(191) NULL,
  `original_name` VARCHAR(191) NULL,
  `mime_type` VARCHAR(191) NULL,
  `size` INTEGER NULL,
  `order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `inventory_item_id` INTEGER NOT NULL,

  INDEX `inventory_item_model_3d_inventory_item_id_idx` (`inventory_item_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `inventory_item_model_3d_inventory_item_id_fkey`
    FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_item` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
