/** 旧简报里常见的纯数字引用，展示时替换为站内「详情」链接 */
export function extractBriefingNumericCitationIds(body: string): number[] {
  const out = new Set<number>();
  const re = /\[\s*(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return Array.from(out);
}

/** 去掉历史输出中的「原文」外链（安全渲染会显示为 [blocked] 等） */
export function stripBriefingOriginalLinks(body: string): string {
  return body.replace(/\s*\[原文\]\([^)]*\)/g, "");
}

export function applyBriefingNumericCitationLinks(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let i = 0;

  const toLink = (id: number) => `[详情](/news/${id})`;
  const collectIds = (text: string): number[] => {
    const set = new Set<number>();
    const reNum = /\[\s*(\d+)\s*\]/g;
    let m1: RegExpExecArray | null;
    while ((m1 = reNum.exec(text)) !== null) {
      const n = Number(m1[1]);
      if (Number.isFinite(n) && n > 0) set.add(n);
    }
    const reDetail = /\[详情\]\(\/news\/(\d+)\)/g;
    let m2: RegExpExecArray | null;
    while ((m2 = reDetail.exec(text)) !== null) {
      const n = Number(m2[1]);
      if (Number.isFinite(n) && n > 0) set.add(n);
    }
    return Array.from(set);
  };
  const stripMarkers = (text: string) =>
    text
      .replace(/\s*\[\s*\d+\s*\]/g, "")
      .replace(/\s*\[详情\]\(\/news\/\d+\)/g, "")
      .trimEnd();

  const allIds = collectIds(body);
  if (allIds.length === 1) {
    const cid = allIds[0];
    const cleaned = lines.map(stripMarkers).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
    return `${cleaned}\n\n> 本文主要引用同一篇资讯：${toLink(cid)}`;
  }

  while (i < lines.length) {
    const line = lines[i];
    const isBullet = /^\s*[-*]\s+/.test(line);
    if (!isBullet) {
      const ids = collectIds(line);
      if (ids.length === 0) {
        out.push(line);
      } else if (ids.length === 1) {
        out.push(`${stripMarkers(line)} ${toLink(ids[0])}`.trimEnd());
      } else {
        out.push(`${stripMarkers(line)} ${ids.map((id) => toLink(id)).join(" ")}`.trimEnd());
      }
      i++;
      continue;
    }

    const blockStart = i;
    const block: string[] = [];
    while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
      block.push(lines[i]);
      i++;
    }

    const idsByLine = block.map(collectIds);
    const sameSingleCitation =
      block.length >= 2 &&
      idsByLine.every((ids) => ids.length === 1) &&
      idsByLine.every((ids) => ids[0] === idsByLine[0][0]);

    if (sameSingleCitation) {
      const cid = idsByLine[0][0];
      for (const row of block) out.push(stripMarkers(row));
      out.push(`> 本段要点统一引用：${toLink(cid)}`);
      if (i < lines.length && lines[i].trim() !== "" && blockStart > 0) out.push("");
      continue;
    }

    for (const row of block) {
      const ids = collectIds(row);
      const clean = stripMarkers(row);
      if (ids.length === 0) {
        out.push(clean);
        continue;
      }
      if (ids.length === 1) {
        out.push(`${clean} ${toLink(ids[0])}`.trimEnd());
        continue;
      }
      const suffix = ids.map((id) => toLink(id)).join(" ");
      out.push(`${clean} ${suffix}`.trimEnd());
    }
  }

  const merged = out.join("\n");
  return mergeSameCitationAtSectionEnd(merged);
}

function mergeSameCitationAtSectionEnd(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let i = 0;
  const sectionHead = /^##\s+/;
  const linkRe = /\[详情\]\(\/news\/(\d+)\)/g;

  while (i < lines.length) {
    if (!sectionHead.test(lines[i])) {
      result.push(lines[i]);
      i++;
      continue;
    }
    const head = lines[i];
    i++;
    const block: string[] = [];
    while (i < lines.length && !sectionHead.test(lines[i])) {
      block.push(lines[i]);
      i++;
    }

    const ids = new Set<number>();
    for (const row of block) {
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(row)) !== null) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) ids.add(n);
      }
    }
    if (ids.size !== 1) {
      result.push(head, ...block);
      continue;
    }
    const onlyId = Array.from(ids)[0];
    const cleaned = block
      .map((row) => row.replace(/\s*\[详情\]\(\/news\/\d+\)/g, "").trimEnd())
      .filter((row, idx, arr) => !(row === "" && arr[idx - 1] === ""));
    while (cleaned.length > 0 && cleaned[cleaned.length - 1] === "") cleaned.pop();
    result.push(head, ...cleaned, "", `> 本章节统一引用：${`[详情](/news/${onlyId})`}`);
  }
  return result.join("\n");
}

export function normalizeBriefingHeadingLabel(body: string): string {
  return body.replace(/(^|\n)(#{1,6}\s*)?晨报([：:])/g, (_m, p1, p2 = "", p3) => {
    return `${p1}${p2}简报${p3}`;
  });
}
