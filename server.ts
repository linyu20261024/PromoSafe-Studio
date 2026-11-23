import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

interface RewriteRequestBody {
  rawText?: string;
  style?: "step_by_step" | "value_highlight" | "minimal_list";
  dictionarySummary?: Array<{ pattern: string; replacement: string }>;
}

interface ImageExtractRequestBody {
  imageBase64?: string;
  mimeType?: string;
  style?: "step_by_step" | "value_highlight" | "minimal_list";
  dictionarySummary?: Array<{ pattern: string; replacement: string }>;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Optional Free-Tier AI copy enhancement proxy
  app.post("/api/copy/rewrite", async (req, res) => {
    const body = req.body as RewriteRequestBody;
    const rawText = typeof body?.rawText === "string" ? body.rawText.trim() : "";
    const style = body?.style ?? "step_by_step";
    const dictionarySummary = Array.isArray(body?.dictionarySummary)
      ? body.dictionarySummary.slice(0, 60)
      : [];

    if (!rawText) {
      res.status(400).json({ error: "请先输入需要处理的活动原文内容。" });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: "当前运行环境未配置云端 AI 密钥，已为您准备本地离线提炼引擎。",
        fallbackRecommended: true,
      });
      return;
    }

    const styleInstructionMap: Record<string, string> = {
      step_by_step: "保姆级实操攻略口吻：分步骤拆解怎么领、怎么用，亲切实用、重点加粗符号清晰。",
      value_highlight: "省钱干货种草口吻：突出补贴金额与性价比对比，节奏紧凑有吸引力。",
      minimal_list: "极简清单体：去水词、纯要点罗列，适合收藏速查。",
    };

    const dictHints = dictionarySummary
      .map((item) => `「${item.pattern}」→「${item.replacement}」`)
      .join("、");

    const systemInstruction = [
      "你是专注中国大陆小红书平台（银行卡、信用卡、支付平台、政府消费券）的资深内容合规编辑。",
      "核心任务：",
      "1. 严格保留原始数字（满减金额、补贴额度、日期、名额、门槛），绝不虚构或篡改优惠力度。",
      "2. 严格规避小红书限流高危词：禁止出现加微信、私信、二维码、扫码领、返现、套现、零门槛、100%必中、全网最低、白嫖、薅羊毛等诱导或金融绝对化表达；尽量使用安全代称或用户指定的替换词。",
      `3. 风格要求：${styleInstructionMap[style] || styleInstructionMap.step_by_step}`,
      dictHints ? `4. 优先遵循以下替换词表：${dictHints}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `请提炼并合规改写以下优惠活动原文，生成3个不同角度的小红书吸睛标题（每条不超过22个字，不带违禁词）以及改写后的合规正文：\n\n${rawText}`,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              highlights: {
                type: Type.OBJECT,
                properties: {
                  institutionAlias: { type: Type.STRING, description: "活动机构或平台的安全代称" },
                  benefitAmount: { type: Type.STRING, description: "核心优惠金额、折扣或补贴" },
                  threshold: { type: Type.STRING, description: "参与条件或满减门槛" },
                  validityPeriod: { type: Type.STRING, description: "活动起止时间或每日抢券时段" },
                  claimPath: { type: Type.STRING, description: "脱敏后的参与入口与领取步骤" },
                  quotaNote: { type: Type.STRING, description: "名额限制、次数上限或注意事项" },
                },
                required: [
                  "institutionAlias",
                  "benefitAmount",
                  "threshold",
                  "validityPeriod",
                  "claimPath",
                  "quotaNote",
                ],
              },
              titles: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    styleLabel: { type: Type.STRING, description: "标题角度，如 利益前置型 / 紧迫截止型 / 省钱攻略型" },
                    text: { type: Type.STRING, description: "合规且吸睛的小红书标题文本" },
                  },
                  required: ["styleLabel", "text"],
                },
              },
              body: {
                type: Type.STRING,
                description: "已剔除敏感词、结构清晰的小红书合规正文（含适度标签建议，不含违规导流词）",
              },
            },
            required: ["highlights", "titles", "body"],
          },
        },
      });

      const rawJson = (response.text ?? "").trim();
      if (!rawJson) {
        res.status(502).json({
          error: "云端 AI 返回内容为空，请重试或使用本地离线引擎。",
          fallbackRecommended: true,
        });
        return;
      }

      const parsed = JSON.parse(rawJson);
      res.json(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "云端 AI 服务暂不可用";
      res.status(502).json({
        error: `云端润色请求失败（${message}），已支持切换回本地离线引擎继续使用。`,
        fallbackRecommended: true,
      });
    }
  });

  // Optional Free-Tier Multimodal AI screenshot-to-copy extraction proxy
  app.post("/api/copy/extract-image", async (req, res) => {
    const body = req.body as ImageExtractRequestBody;
    const imageBase64 =
      typeof body?.imageBase64 === "string" ? body.imageBase64.trim() : "";
    const mimeType =
      typeof body?.mimeType === "string" && body.mimeType.startsWith("image/")
        ? body.mimeType
        : "image/png";
    const style = body?.style ?? "step_by_step";
    const dictionarySummary = Array.isArray(body?.dictionarySummary)
      ? body.dictionarySummary.slice(0, 60)
      : [];

    if (!imageBase64) {
      res.status(400).json({ error: "请先上传需要识别的活动截图。" });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: "当前环境未配置云端密钥，已自动切换本地预处理识别引擎。",
        fallbackRecommended: true,
      });
      return;
    }

    const styleInstructionMap: Record<string, string> = {
      step_by_step: "保姆级实操攻略口吻：分步骤拆解怎么领、怎么用，重点清晰。",
      value_highlight: "省钱干货种草口吻：突出补贴金额与性价比对比，节奏紧凑。",
      minimal_list: "极简清单体：去水词、纯要点罗列，适合收藏速查。",
    };

    const dictHints = dictionarySummary
      .map((item) => `「${item.pattern}」→「${item.replacement}」`)
      .join("、");

    const systemInstruction = [
      "你是专注中国大陆小红书平台（银行卡、信用卡、支付平台、政府消费券）的资深内容合规编辑。",
      "请先准确读取用户上传的活动截图中的所有可见文字（忽略装饰背景与无意义水印，精准识别满减数字、银行/平台名、截止日期、参与门槛、领取路径与限额），再按以下要求输出：",
      "1. extractedRawText 必须忠实还原截图里的活动原文信息，不要漏掉关键角标数字。",
      "2. 改写后的 titles 与 body 必须严格规避小红书限流高危词（加微信、私信、二维码、扫码领、返现、套现、零门槛、100%必中、全网最低、白嫖、薅羊毛等）。",
      `3. 风格要求：${styleInstructionMap[style] || styleInstructionMap.step_by_step}`,
      dictHints ? `4. 优先遵循以下替换词表：${dictHints}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            {
              text: "请完整识别这张活动截图中的活动信息，提炼重点要素，生成3个不同角度的小红书吸睛标题（每条不超过22字，无违禁词），并按指定风格输出合规正文。",
            },
          ],
        },
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              extractedRawText: {
                type: Type.STRING,
                description: "从截图中完整识别出的原始活动文本信息",
              },
              highlights: {
                type: Type.OBJECT,
                properties: {
                  institutionAlias: { type: Type.STRING },
                  benefitAmount: { type: Type.STRING },
                  threshold: { type: Type.STRING },
                  validityPeriod: { type: Type.STRING },
                  claimPath: { type: Type.STRING },
                  quotaNote: { type: Type.STRING },
                },
                required: [
                  "institutionAlias",
                  "benefitAmount",
                  "threshold",
                  "validityPeriod",
                  "claimPath",
                  "quotaNote",
                ],
              },
              titles: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    styleLabel: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                  required: ["styleLabel", "text"],
                },
              },
              body: {
                type: Type.STRING,
              },
            },
            required: ["extractedRawText", "highlights", "titles", "body"],
          },
        },
      });

      const rawJson = (response.text ?? "").trim();
      if (!rawJson) {
        res.status(502).json({
          error: "云端识图返回为空，已支持自动切换至本地识别引擎。",
          fallbackRecommended: true,
        });
        return;
      }

      const parsed = JSON.parse(rawJson);
      res.json(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "云端识图暂不可用";
      res.status(502).json({
        error: `云端识图失败（${message}），已自动切换本地预处理识别。`,
        fallbackRecommended: true,
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PromoSafe Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
