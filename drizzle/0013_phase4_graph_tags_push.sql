-- Phase 4: 知识图谱 + 标签学习 + 简报推送

CREATE TABLE IF NOT EXISTS `entities` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(256) NOT NULL,
  `type` enum('fund','institution','person','other') NOT NULL,
  `aliases` JSON NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `entities_id` PRIMARY KEY(`id`)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `entity_articles` (
  `id` int AUTO_INCREMENT NOT NULL,
  `entityId` int NOT NULL,
  `articleId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `entity_articles_id` PRIMARY KEY(`id`),
  INDEX `idx_ea_entity` (`entityId`),
  INDEX `idx_ea_article` (`articleId`)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `entity_relations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sourceEntityId` int NOT NULL,
  `targetEntityId` int NOT NULL,
  `relationType` varchar(64) NOT NULL,
  `articleId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `entity_relations_id` PRIMARY KEY(`id`),
  INDEX `idx_er_source` (`sourceEntityId`),
  INDEX `idx_er_target` (`targetEntityId`)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `tag_corrections` (
  `id` int AUTO_INCREMENT NOT NULL,
  `articleId` int NOT NULL,
  `userId` int NULL,
  `fieldName` enum('tags','strategy','region') NOT NULL,
  `oldValue` text NULL,
  `newValue` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `tag_corrections_id` PRIMARY KEY(`id`),
  INDEX `idx_tc_article` (`articleId`)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `briefing_subscriptions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NULL,
  `email` varchar(320) NULL,
  `webhookUrl` varchar(1024) NULL,
  `isEnabled` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `briefing_subscriptions_id` PRIMARY KEY(`id`)
);
