-- 资讯语义检索 embedding + AI 简报表
ALTER TABLE `news_articles` ADD COLUMN `embedding` JSON NULL AFTER `viewCount`;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `ai_briefings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `body` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `ai_briefings_id` PRIMARY KEY(`id`)
);
