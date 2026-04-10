CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`userId` int,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `news_articles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(512) NOT NULL,
	`summary` text,
	`content` text,
	`source` enum('Preqin','Pitchbook') NOT NULL,
	`originalUrl` varchar(1024),
	`author` varchar(128),
	`tags` json DEFAULT ('[]'),
	`strategy` enum('私募股权','风险投资','房地产','信贷','基础设施','对冲基金','母基金','并购','成长股权','其他'),
	`region` enum('全球','亚太','北美','欧洲','中国','东南亚','中东','其他'),
	`keyInsights` json DEFAULT ('[]'),
	`publishedAt` timestamp NOT NULL,
	`isRead` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `news_articles_id` PRIMARY KEY(`id`)
);
