ALTER TABLE `news_articles` MODIFY COLUMN `source` ENUM('Preqin', 'Pitchbook', 'Manual') NOT NULL;
ALTER TABLE `news_articles` ADD `uploaderUserId` int;
ALTER TABLE `news_articles` ADD `fileUploadedAt` timestamp;
ALTER TABLE `news_articles` ADD `attachmentStorageKey` varchar(512);
ALTER TABLE `news_articles` ADD `attachmentMime` varchar(128);
ALTER TABLE `news_articles` ADD `attachmentOriginalName` varchar(512);
ALTER TABLE `news_articles` ADD `effectivePeriodLabel` varchar(512);
ALTER TABLE `news_articles` ADD `extractedText` text;
