export type SensitiveCategory =
  | "redirect"
  | "financial_abs"
  | "brand"
  | "promo_risk"
  | "custom";

export interface SensitiveRule {
  id: string;
  pattern: string;
  replacement: string;
  category: SensitiveCategory;
  isBuiltin: boolean;
  enabled: boolean;
  note?: string;
}

export type CopyStyle = "step_by_step" | "value_highlight" | "minimal_list";

export interface ExtractedHighlights {
  institutionAlias: string;
  benefitAmount: string;
  threshold: string;
  validityPeriod: string;
  claimPath: string;
  quotaNote: string;
}

export interface TitleCandidate {
  styleLabel: string;
  text: string;
}

export interface ReplacementMatch {
  original: string;
  replacement: string;
  category: SensitiveCategory;
  count: number;
}

export interface DiffSegment {
  text: string;
  type: "unchanged" | "replaced";
  original?: string;
  category?: SensitiveCategory;
}

export interface CopyResult {
  sourceText: string;
  style: CopyStyle;
  engineMode: "local" | "ai_enhanced";
  highlights: ExtractedHighlights;
  titles: TitleCandidate[];
  cleanBody: string;
  rawBeforeDictBody: string;
  diffSegments: DiffSegment[];
  matches: ReplacementMatch[];
  timestamp: number;
}

export type MaskTool = "rect" | "brush";
export type MaskFillMode = "edge_sample" | "blur" | "solid";

export interface Point2D {
  x: number; // normalized 0..1 relative to source image width
  y: number; // normalized 0..1 relative to source image height
}

export interface MaskStroke {
  id: string;
  tool: MaskTool;
  fillMode: MaskFillMode;
  brushSize: number; // normalized fraction relative to min(w, h), e.g., 0.04
  points: Point2D[];
  rect?: { x: number; y: number; w: number; h: number }; // normalized 0..1
  solidColor?: string;
}

export type AspectRatioOption = "3:4" | "1:1" | "16:9";

export interface BackgroundPreset {
  id: string;
  name: string;
  kind: "image" | "gradient" | "solid";
  value: string;
  secondaryValue?: string;
  textColor?: string;
}

export interface ImageStudioConfig {
  aspectRatio: AspectRatioOption;
  backgroundId: string;
  paddingPercent: number;
  borderRadius: number;
  shadowStrength: number;
  footerText: string;
  perturbFingerprint: boolean;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  title: string;
  summary: string;
  copyResult?: CopyResult;
  imageSnapshot?: {
    outputDataUrl: string;
    aspectRatio: AspectRatioOption;
    backgroundId: string;
  };
}

export type ActiveTab = "workbench" | "dictionary" | "history";
