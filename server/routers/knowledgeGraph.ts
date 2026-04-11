import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import {
  getAllEntities,
  getAllEntityRelations,
  getEntityArticleLinks,
  getNewsArticleById,
} from "../db";
import { extractAndStoreEntities } from "../_core/entityExtraction";

export const knowledgeGraphRouter = router({
  graph: publicProcedure.query(async () => {
    const [nodes, edges] = await Promise.all([
      getAllEntities(),
      getAllEntityRelations(),
    ]);
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        aliases: n.aliases,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.sourceEntityId,
        target: e.targetEntityId,
        relation: e.relationType,
        articleId: e.articleId,
      })),
    };
  }),

  entityArticles: publicProcedure
    .input(z.object({ entityId: z.number().int() }))
    .query(async ({ input }) => {
      const links = await getEntityArticleLinks(input.entityId);
      const articles = await Promise.all(
        links.map((l) => getNewsArticleById(l.articleId))
      );
      return articles
        .filter(Boolean)
        .map((a) => ({ id: a!.id, title: a!.title, source: a!.source }));
    }),

  /** 管理员手动触发某篇文章的实体抽取 */
  extractForArticle: adminProcedure
    .input(z.object({ articleId: z.number().int() }))
    .mutation(async ({ input }) => {
      const article = await getNewsArticleById(input.articleId);
      if (!article) throw new Error("文章不存在");
      await extractAndStoreEntities(article);
      return { success: true };
    }),
});
