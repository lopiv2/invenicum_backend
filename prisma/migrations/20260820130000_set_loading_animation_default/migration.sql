-- Normalize the previous fallback and use the first SpinKit animation.
UPDATE `user_preferences`
SET `loading_animation` = 'rotatingPlain'
WHERE `loading_animation` = 'circular';

ALTER TABLE `user_preferences`
ALTER COLUMN `loading_animation` SET DEFAULT 'rotatingPlain';
