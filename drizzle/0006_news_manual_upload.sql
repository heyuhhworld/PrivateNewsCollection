ALTER TABLE `news_articles` MODIFY COLUMN `source` ENUM('Preqin', 'Pitchbook', 'Manual') NOT NULL;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `uploaderUserId` int;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `fileUploadedAt` timestamp;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `attachmentStorageKey` varchar(512);--> statement-breakpoint
ALTER TABLE `news_articles` ADD `attachmentMime` varchar(128);--> statement-breakpoint
ALTER TABLE `news_articles` ADD `attachmentOriginalName` varchar(512);--> statement-breakpoint
ALTER TABLE `news_articles` ADD `effectivePeriodLabel` varchar(512);--> statement-breakpoint
ALTER TABLE `news_articles` ADD `extractedText` text;
