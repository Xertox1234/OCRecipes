export interface PurchaseError {
  code:
    | "NETWORK"
    | "STORE_UNAVAILABLE"
    | "ALREADY_OWNED"
    | "USER_CANCELLED"
    // The store has no purchase of ours to restore.
    | "NOTHING_TO_RESTORE"
    // The purchase waits on someone else's approval (e.g. Ask to Buy).
    | "PENDING_APPROVAL"
    | "UNKNOWN";
  message: string;
  originalError?: unknown;
}

export type PurchaseState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "pending" }
  | { status: "success" }
  | { status: "cancelled" }
  | { status: "restoring" }
  | { status: "error"; error: PurchaseError };
