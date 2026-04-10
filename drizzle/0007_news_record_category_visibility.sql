ALTER TABLE `news_articles`
  ADD COLUMN `recordCategory` ENUM('report', 'news') NOT NULL DEFAULT 'news',
  ADD COLUMN `isHidden` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN `contentZh` text;

UPDATE `news_articles` SET `recordCategory` = IF(`source` = 'Manual', 'report', 'news');
