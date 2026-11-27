export type ItemKind = 'part' | 'labour' | 'paint' | 'material' | 'deduction' | 'other';
export type PartQuality = 'oem' | 'alternative' | 'used' | 'unknown';

export interface EstimateItem {
  id: string;
  desc: string;
  kind: ItemKind;
  qty: number | null;
  hours: number | null;
  unitPrice: number | null;
  total: number | null;
  partQuality: PartQuality;
  /** Set when the on-device reading of this line is doubtful and could not be settled by the total. */
  check?: boolean;
}

export interface Estimate {
  currency: string;
  /** Hourly rate the insurer used for body and mechanical work. */
  labourRate: number | null;
  /** Hourly rate the insurer used for paint work. */
  paintRate: number | null;
  /** Total printed on the estimate, before VAT where the document says so. */
  statedTotal: number | null;
  items: EstimateItem[];
  /**
   * Descriptions of the detail lines, kept when the amounts come from the totals block.
   * They say what work the estimate covers; they carry no amounts.
   */
  details?: string[];
}

export type Tier = 'cautious' | 'realistic' | 'optimistic';
export type Tiered = Record<Tier, number>;

export type RuleId =
  | 'quote'
  | 'labourRate'
  | 'paintRate'
  | 'deductions'
  | 'vat'
  | 'alternativeParts'
  | 'missingCalibration'
  | 'missingAlignment'
  | 'arithmetic';

export interface Finding {
  id: RuleId;
  /** Findings with an amount can be claimed; the rest are questions to raise. */
  amounts: Tiered | null;
  params: Record<string, string | number>;
  itemIds: string[];
}

export interface RefRates {
  low: number;
  mid: number;
  high: number;
}

export interface AuditSettings {
  refRates: RefRates;
  /** The printed total excludes VAT. */
  totalIsNet: boolean;
  /** The claimant can reclaim VAT (for example a VAT-registered business). */
  claimantDeductsVat: boolean;
  vatRatePct: number;
}

export type InferenceSource = 'on_device' | 'in_cloud' | 'none';

export interface InferenceLogEntry {
  at: number;
  step: 'read' | 'letter' | 'explain';
  source: InferenceSource;
  redactions: number;
  note?: string;
}

export type Lang = 'en' | 'pl';
