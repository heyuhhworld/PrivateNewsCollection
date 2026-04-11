CREATE TABLE IF NOT EXISTS `article_pdf_highlights` (
  `id` int AUTO_INCREMENT NOT NULL,
  `articleId` int NOT NULL,
  `userId` int,
  `sessionId` varchar(64),
  `page` int NOT NULL,
  `rectsNorm` json NOT NULL,
  `color` varchar(32) DEFAULT '#fde047',
  `note` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `article_pdf_highlights_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `article_reading_images` (
  `id` int AUTO_INCREMENT NOT NULL,
  `articleId` int NOT NULL,
  `createdByUserId` int,
  `sessionId` varchar(64),
  `storageKey` varchar(512) NOT NULL,
  `caption` text,
  `sourcePage` int,
  `sourceRect` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `article_reading_images_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `reading_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int,
  `sessionId` varchar(64),
  `articleId` int,
  `recordCategory` varchar(32),
  `eventType` varchar(64) NOT NULL,
  `payload` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `reading_events_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `user_reading_profiles` (
  `userId` int NOT NULL,
  `summaryJson` json NOT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `user_reading_profiles_userId` PRIMARY KEY(`userId`)
);
