/**
 * Wikipedia 名词解释查询。
 *
 * 流程：先用 MediaWiki 搜索 API 找最佳条目，再取 REST summary 摘要。
 * 均走公开接口（CORS 开放，CSP 为 null 可直接 fetch）。
 * 语言代码与界面语言一一对应（10 种）。
 */

export interface WikiResult {
  /** 规范化后的条目标题 */
  title: string;
  /** 条目简介（纯文本） */
  extract: string;
  /** 条目页面 URL（桌面版） */
  url: string;
  /** 可选：条目缩略图 */
  thumbnail?: string;
  /** 内容许可短名（如 "CC BY-SA 4.0"） */
  license: string;
}

/** 界面语言 → Wikipedia 语言代码（一一对应） */
const WIKI_LANG: Record<string, string> = {
  zh: "zh",
  en: "en",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  de: "de",
  es: "es",
  ru: "ru",
  pt: "pt",
  it: "it",
};

/** 界面语言 → Wikipedia 语言代码，未知回退 en */
export function wikiLang(uiLang: string): string {
  return WIKI_LANG[uiLang] ?? "en";
}

/** 用 MediaWiki 搜索 API 找到最匹配的条目标题；无结果返回 null */
async function searchTitle(
  lang: string,
  query: string,
  signal?: AbortSignal
): Promise<string | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*", // 匿名 CORS 必需
    list: "search",
    srsearch: query,
    srlimit: "1",
    srnamespace: "0",
  });
  const res = await fetch(
    `https://${lang}.wikipedia.org/w/api.php?${params}`,
    { signal }
  );
  if (!res.ok) throw new Error(`http:${res.status}`);
  const data = await res.json();
  return data?.query?.search?.[0]?.title ?? null;
}

/**
 * 查询指定名词在给定语言 Wikipedia 的条目摘要。
 * 错误通过 Error.message 传递错误码：`not-found` | `empty` | `http:<status>` | `network`
 */
export async function fetchWikipediaSummary(
  query: string,
  lang: string,
  signal?: AbortSignal
): Promise<WikiResult> {
  let title: string | null;
  try {
    title = await searchTitle(lang, query, signal);
  } catch (err) {
    throw err instanceof Error && err.message.startsWith("http:")
      ? err
      : new Error("network");
  }
  if (!title) throw new Error("not-found");

  const res = await fetch(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/ /g, "_")
    )}`,
    { signal, headers: { Accept: "application/json" } }
  );
  if (res.status === 404) throw new Error("not-found");
  if (!res.ok) throw new Error(`http:${res.status}`);
  const data = await res.json().catch(() => null);
  const extract = data?.extract?.trim();
  if (!extract) throw new Error("empty");
  return {
    title: data.title ?? title,
    extract,
    url:
      data.content_urls?.desktop?.page ??
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(
        title.replace(/ /g, "_")
      )}`,
    thumbnail: data.thumbnail?.source,
    license: data.license?.type ?? "CC BY-SA 4.0",
  };
}
