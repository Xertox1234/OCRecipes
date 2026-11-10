import { z } from "zod";

/** Shape of front-label data stored as JSONB on barcodeVerifications */
export const frontLabelDataSchema = z.object({
  brand: z.string().nullable(),
  productName: z.string().nullable(),
  netWeight: z.string().nullable(),
  claims: z.array(z.string()).max(20),
  /** No longer written (privacy audit 2026-11-10, L1); rows stored before
   *  that may still carry it until the scanner's account is deleted. */
  scannedByUserId: z.string().optional(),
  scannedAt: z.string(),
});
export type FrontLabelData = z.infer<typeof frontLabelDataSchema>;

/** Result returned by the Vision API front-label extraction */
export interface FrontLabelExtractionResult {
  brand: string | null;
  productName: string | null;
  netWeight: string | null;
  claims: string[];
  confidence: number;
}

/** Response from POST /api/verification/front-label (upload + extract) */
export interface FrontLabelAnalysisResponse {
  sessionId: string;
  data: FrontLabelExtractionResult;
}

/** Response from POST /api/verification/front-label/confirm */
export interface FrontLabelConfirmResponse {
  success: boolean;
  frontLabelScanned: boolean;
}
