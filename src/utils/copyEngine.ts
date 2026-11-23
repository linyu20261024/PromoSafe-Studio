import type {
  CopyResult,
  CopyStyle,
  DiffSegment,
  ExtractedHighlights,
  ReplacementMatch,
  SensitiveCategory,
  SensitiveRule,
  TitleCandidate,
} from "../types/index.ts";

interface ExpandedToken {
  term: string;
  replacement: string;
  category: SensitiveCategory;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandRules(rules: SensitiveRule[]): ExpandedToken[] {
  const tokens: ExpandedToken[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const parts = rule.pattern
      .split(/[/|,，、]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const term of parts) {
      tokens.push({
        term,
        replacement: rule.replacement,
        category: rule.category,
      });
    }
  }
  // Sort longest match first so compound phrases (e.g., 微信支付) match before shorter ones (微信)
  tokens.sort((a, b) => b.term.length - a.term.length);
  return tokens;
}

export function applySensitiveDictionary(
  inputText: string,
  rules: SensitiveRule[]
): {
  cleanText: string;
  diffSegments: DiffSegment[];
  matches: ReplacementMatch[];
} {
  const tokens = expandRules(rules);
  if (!inputText || tokens.length === 0) {
    return {
      cleanText: inputText,
      diffSegments: inputText ? [{ text: inputText, type: "unchanged" }] : [],
      matches: [],
    };
  }

  const tokenMap = new Map<string, ExpandedToken>();
  for (const t of tokens) {
    if (!tokenMap.has(t.term)) {
      tokenMap.set(t.term, t);
    }
  }

  const regexPattern = Array.from(tokenMap.keys()).map(escapeRegExp).join("|");
  if (!regexPattern) {
    return {
      cleanText: inputText,
      diffSegments: [{ text: inputText, type: "unchanged" }],
      matches: [],
    };
  }

  const regex = new RegExp(regexPattern, "g");
  const diffSegments: DiffSegment[] = [];
  const matchCounters = new Map<string, ReplacementMatch>();
  let cleanParts: string[] = [];
  let lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = regex.exec(inputText)) !== null) {
    const matchedTerm = m[0];
    const startIdx = m.index;

    if (startIdx > lastIndex) {
      const plain = inputText.slice(lastIndex, startIdx);
      diffSegments.push({ text: plain, type: "unchanged" });
      cleanParts.push(plain);
    }

    const token = tokenMap.get(matchedTerm);
    if (token) {
      diffSegments.push({
        text: token.replacement,
        type: "replaced",
        original: matchedTerm,
        category: token.category,
      });
      cleanParts.push(token.replacement);

      const key = `${matchedTerm}__${token.replacement}`;
      const existing = matchCounters.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        matchCounters.set(key, {
          original: matchedTerm,
          replacement: token.replacement,
          category: token.category,
          count: 1,
        });
      }
    } else {
      diffSegments.push({ text: matchedTerm, type: "unchanged" });
      cleanParts.push(matchedTerm);
    }

    lastIndex = startIdx + matchedTerm.length;
  }

  if (lastIndex < inputText.length) {
    const tail = inputText.slice(lastIndex);
    diffSegments.push({ text: tail, type: "unchanged" });
    cleanParts.push(tail);
  }

  return {
    cleanText: cleanParts.join(""),
    diffSegments,
    matches: Array.from(matchCounters.values()),
  };
}

function firstMatch(text: string, patterns: RegExp[], fallback: string): string {
  for (const re of patterns) {
    const found = text.match(re);
    if (found && found[0]) {
      return found[0].trim();
    }
  }
  return fallback;
}

function collectMatches(text: string, patterns: RegExp[]): string[] {
  const results = new Set<string>();
  for (const re of patterns) {
    const globalRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    const found = text.match(globalRe);
    if (found) {
      for (const item of found) {
        const cleaned = item.trim();
        if (cleaned.length >= 2) results.add(cleaned);
      }
    }
  }
  return Array.from(results);
}

export function extractHighlightsLocally(
  rawText: string,
  rules: SensitiveRule[]
): ExtractedHighlights {
  const text = rawText.replace(/\s+/g, " ").trim();

  // 1. Institution / Platform alias
  const brandPatterns = [
    /(招商银行|招行|工商银行|工行|建设银行|建行|农业银行|农行|中国银行|中行|交通银行|交行|邮储银行|中信银行|浦发银行|兴业银行|平安银行|广发银行|云闪付|支付宝|微信支付|美团|京东|地方消费券|绿色家电消费补贴)/g,
    /【([^【】]{2,18})】/,
  ];
  const rawInstitutions = collectMatches(text, [brandPatterns[0]]);
  let rawInstitution = rawInstitutions.slice(0, 2).join(" × ");
  if (!rawInstitution) {
    const bracketMatch = text.match(/【([^【】]{2,18})】/);
    rawInstitution = bracketMatch?.[1] ?? "官方优惠活动";
  }
  const institutionAlias = applySensitiveDictionary(rawInstitution, rules).cleanText;

  // 2. Benefit amount
  const amountList = collectMatches(text, [
    /满\d+(?:\.\d+)?元?减\d+(?:\.\d+)?元?/g,
    /立减\d+(?:\.\d+)?元?/g,
    /最高(?:补贴|立减|可减|优惠)?\d+(?:\.\d+)?元/g,
    /\d+(?:\.\d+)?折/g,
    /补贴\d+(?:\.\d+)?元?/g,
  ]);
  const benefitAmount =
    amountList.length > 0 ? amountList.slice(0, 3).join(" / ") : "详见活动档位说明";

  // 3. Threshold
  const threshold = firstMatch(
    text,
    [
      /(?:单笔消费|消费|下单)?满\d+(?:\.\d+)?元可用/,
      /持[^，。；\s]{2,14}?(?:信用卡|储蓄卡|借记卡)/,
      /(?:常住用户|新户|指定商户|达标客户)[^，。；]{0,12}/,
      /零门槛|无门槛|低门槛/,
    ],
    "指定支付渠道达标即可"
  );

  // 4. Validity period
  const validityPeriod = firstMatch(
    text,
    [
      /(?:即日起至|截止至?)\d{4}年?\d{1,2}月\d{1,2}日[^，。；]*/,
      /\d{4}年\d{1,2}月\d{1,2}日[-至到]\d{1,2}月\d{1,2}日[^，。；]*/,
      /(?:即日起至|截止)\d{1,2}月\d{1,2}日[^，。；]*/,
      /(?:每周[一二三四五六日天]|每日|每天)[^，。；]{1,12}[点:：\d]+/,
    ],
    "近期限时开放（以页面展示为准）"
  );

  // 5. Claim path
  const claimPath = firstMatch(
    text,
    [
      /打开[^，。；]{2,16}?(?:APP|App|app)[^，。；]{0,18}/,
      /搜索[“"「][^”"」]{1,14}[”"」][^，。；]{0,12}/,
      /选择[^，。；]{2,16}?支付/,
    ],
    "官方 APP 搜索活动关键词进入"
  );

  // 6. Quota note
  const quotaParts = collectMatches(text, [
    /每人[^，。；]{1,12}限[^，。；]{1,10}/g,
    /同一用户[^，。；]{1,16}/g,
    /每日限量\d+[^，。；]{0,6}/g,
    /名额有限[^，。；]{0,8}/g,
    /先到先得/g,
  ]);
  const quotaNote =
    quotaParts.length > 0 ? quotaParts.slice(0, 2).join(" · ") : "名额有限，用完即止";

  return {
    institutionAlias,
    benefitAmount: applySensitiveDictionary(benefitAmount, rules).cleanText,
    threshold: applySensitiveDictionary(threshold, rules).cleanText,
    validityPeriod: applySensitiveDictionary(validityPeriod, rules).cleanText,
    claimPath: applySensitiveDictionary(claimPath, rules).cleanText,
    quotaNote: applySensitiveDictionary(quotaNote, rules).cleanText,
  };
}

function buildLocalTitles(highlights: ExtractedHighlights): TitleCandidate[] {
  const shortAmount = highlights.benefitAmount.split("/")[0]?.trim() || "大额立减";
  const shortInst = highlights.institutionAlias.split("×")[0]?.trim() || "实用补贴";

  return [
    {
      styleLabel: "利益前置型",
      text: `${shortInst}发钱啦！${shortAmount}别错过`,
    },
    {
      styleLabel: "紧迫截止型",
      text: `抓紧领！${shortInst}${shortAmount}名额有限`,
    },
    {
      styleLabel: "省钱攻略型",
      text: `实测省钱清单｜${shortInst}${shortAmount}这样领`,
    },
  ];
}

function buildLocalBody(
  highlights: ExtractedHighlights,
  style: CopyStyle
): string {
  if (style === "minimal_list") {
    return [
      `整理一份近期超值的${highlights.institutionAlias}优惠清单，建议先马住防走丢：`,
      "",
      `▸ 补贴力度：${highlights.benefitAmount}`,
      `▸ 参与条件：${highlights.threshold}`,
      `▸ 活动时间：${highlights.validityPeriod}`,
      `▸ 领取入口：${highlights.claimPath}`,
      `▸ 次数限制：${highlights.quotaNote}`,
      "",
      "小提示：具体可用范围与剩余名额以官方活动页实时显示为准，有需要的朋友按需参与即可。",
      "#省钱攻略 #日常好价 #消费补贴 #实用信息分享",
    ].join("\n");
  }

  if (style === "value_highlight") {
    return [
      `近期蹲到一个很香的${highlights.institutionAlias}补贴，算下来能省出好几杯奶茶钱，重点直接帮大家划好了：`,
      "",
      `一、到底能省多少？`,
      `本次核心力度是【${highlights.benefitAmount}】，日常刚需消费基本都能顺手用上，性价比在线。`,
      "",
      `二、怎么参与最顺滑？`,
      `• 适用条件：${highlights.threshold}`,
      `• 开放时段：${highlights.validityPeriod}`,
      `• 入口路径：${highlights.claimPath}`,
      "",
      `三、避坑提醒`,
      `名额方面【${highlights.quotaNote}】，建议提前看清活动细则再下单，避免白跑一趟。`,
      "",
      "#好价分享 #省钱日常 #生活攻略 #实用干货",
    ].join("\n");
  }

  // default: step_by_step
  return [
    `整理了一份${highlights.institutionAlias}的保姆级领取攻略，去掉了复杂套路，按下面几步走就行：`,
    "",
    `第一步：确认资格与力度`,
    `本次优惠幅度为 ${highlights.benefitAmount}，需要满足 ${highlights.threshold}。`,
    "",
    `第二步：找准官方入口`,
    `在对应周期（${highlights.validityPeriod}）内，按照「${highlights.claimPath}」即可查看当前可领档位。`,
    "",
    `第三步：留意名额与细节`,
    `活动限制说明：${highlights.quotaNote}。建议先看清适用商户范围再付款，理性消费不踩坑。`,
    "",
    "#保姆级攻略 #省钱笔记 #消费券指南 #实用分享",
  ].join("\n");
}

export function runLocalCopyEngine(
  rawText: string,
  style: CopyStyle,
  rules: SensitiveRule[]
): CopyResult {
  const highlights = extractHighlightsLocally(rawText, rules);
  const rawTitles = buildLocalTitles(highlights);
  const rawBody = buildLocalBody(highlights, style);

  const sanitizedTitles: TitleCandidate[] = rawTitles.map((t) => ({
    styleLabel: t.styleLabel,
    text: applySensitiveDictionary(t.text, rules).cleanText,
  }));

  const bodyProcessed = applySensitiveDictionary(rawBody, rules);

  return {
    sourceText: rawText,
    style,
    engineMode: "local",
    highlights,
    titles: sanitizedTitles,
    cleanBody: bodyProcessed.cleanText,
    rawBeforeDictBody: rawBody,
    diffSegments: bodyProcessed.diffSegments,
    matches: bodyProcessed.matches,
    timestamp: Date.now(),
  };
}

export function reapplyDictionaryToResult(
  previous: CopyResult,
  rules: SensitiveRule[]
): CopyResult {
  const bodyProcessed = applySensitiveDictionary(previous.rawBeforeDictBody, rules);
  const sanitizedTitles = previous.titles.map((t) => ({
    styleLabel: t.styleLabel,
    text: applySensitiveDictionary(t.text, rules).cleanText,
  }));

  return {
    ...previous,
    titles: sanitizedTitles,
    cleanBody: bodyProcessed.cleanText,
    diffSegments: bodyProcessed.diffSegments,
    matches: bodyProcessed.matches,
  };
}
