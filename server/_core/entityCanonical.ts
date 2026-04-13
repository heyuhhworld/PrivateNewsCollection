/**
 * 知识图谱实体名规范化：合并「PitchBook / Pitchbook / PitchBook…」等同源写法，
 * 便于入库去重与定期拓扑合并。
 */

/** 折叠空白与尾部省略号后，生成展示用规范名（可扩展更多品牌） */
export function canonicalEntityDisplayName(raw: string): string {
  let t = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  t = t.replace(/[…．.]{3,}\s*$/, "").replace(/…$/, "").trim();
  const alnum = t.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^pitch\s*book\b/i.test(t) || alnum === "pitchbook") return "PitchBook";
  if (/^preqin\b/i.test(t)) return "Preqin";
  if (/^morning\s*star\b/i.test(t) || alnum === "morningstar") return "Morningstar";
  return t;
}

/**
 * 用于去重分组的稳定键（小写、仅保留字母数字与中日韩统一表意文字）。
 * 同一键下的多条 `entities` 行会在定期任务中合并为一条并迁移边。
 */
export function entityMatchKey(raw: string): string {
  const c = canonicalEntityDisplayName(raw);
  return c
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

/** 同组内选作主实体：已知品牌名 > institution > fund > person > other > id 升序 */
export function compareEntitiesForMerge(
  a: { id: number; name: string; type: string },
  b: { id: number; name: string; type: string }
): number {
  const rank = (t: string) =>
    t === "institution" ? 0 : t === "fund" ? 1 : t === "person" ? 2 : 3;
  const brand = (n: string) => {
    const x = canonicalEntityDisplayName(n);
    if (x === "PitchBook" || x === "Preqin" || x === "Morningstar") return 0;
    return 1;
  };
  const d0 = brand(a.name) - brand(b.name);
  if (d0 !== 0) return d0;
  const d1 = rank(a.type) - rank(b.type);
  if (d1 !== 0) return d1;
  return a.id - b.id;
}
