import type { User } from "../../drizzle/schema";
import * as db from "../db";

const LOCAL_DEV_OPEN_ID = "__local_dev__";

let loggedBypassHint = false;

/**
 * 开发模式下使用的默认用户（与数据库同步时优先写入 DB，便于外键等场景）
 */
export async function getDevBypassUser(): Promise<User> {
  if (!loggedBypassHint) {
    loggedBypassHint = true;
    console.log(
      "[Auth] 开发免登录已开启（DEV_ALLOW_AUTH_BYPASS）：使用本地开发用户；关闭此项后须走 OAuth 真实登录"
    );
  }
  const database = await db.getDb();
  if (database) {
    try {
      await db.upsertUser({
        openId: LOCAL_DEV_OPEN_ID,
        name: "本地开发者",
        email: "dev@localhost",
        loginMethod: "dev",
        role: "admin",
        lastSignedIn: new Date(),
      });
      const row = await db.getUserByOpenId(LOCAL_DEV_OPEN_ID);
      if (row) {
        return row;
      }
    } catch (e) {
      console.warn(
        "[Auth] 开发模式跳过登录：无法写入/读取数据库，使用内存用户。",
        e
      );
    }
  }

  const now = new Date();
  return {
    id: 0,
    openId: LOCAL_DEV_OPEN_ID,
    name: "本地开发者",
    email: "dev@localhost",
    loginMethod: "dev",
    role: "admin",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}
