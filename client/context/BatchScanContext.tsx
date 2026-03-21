import React, {
  createContext,
  useContext,
  useReducer,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { apiRequest } from "@/lib/query-client";
import type { BatchItem, ResolvedBatchItem } from "@shared/types/batch-scan";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type BatchAction =
  | { type: "START_SESSION" }
  | { type: "ADD_ITEM"; item: BatchItem }
  | { type: "REMOVE_ITEM"; wasPending: boolean }
  | { type: "RESOLVE_ITEM" }
  | { type: "FAIL_ITEM" }
  | { type: "RETRY_ITEM" }
  | { type: "SET_SAVING"; isSaving: boolean }
  | { type: "CLEAR" };

// ---------------------------------------------------------------------------
// State (only values that trigger re-renders)
// ---------------------------------------------------------------------------

interface BatchState {
  itemCount: number;
  pendingCount: number;
  isSaving: boolean;
}

const initialState: BatchState = {
  itemCount: 0,
  pendingCount: 0,
  isSaving: false,
};

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

interface BatchScanContextValue {
  itemCount: number;
  pendingCount: number;
  isSaving: boolean;
  getItems: () => BatchItem[];
  startSession: () => void;
  addItemAndLookup: (barcode: string) => void;
  incrementQuantity: (barcode: string) => void;
  updateItemQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  retryItem: (id: string) => void;
  clearSession: () => void;
  setSaving: (saving: boolean) => void;
}

const BatchScanContext = createContext<BatchScanContextValue | null>(null);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_LOOKUPS = 3;
const MAX_ITEMS = 50;

let idCounter = 0;
function generateItemId(): string {
  idCounter++;
  return `batch-${Date.now()}-${idCounter}`;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case "START_SESSION":
      return initialState;
    case "ADD_ITEM":
      return {
        ...state,
        itemCount: state.itemCount + 1,
        pendingCount:
          action.item.status === "pending"
            ? state.pendingCount + 1
            : state.pendingCount,
      };
    case "REMOVE_ITEM":
      return {
        ...state,
        itemCount: Math.max(0, state.itemCount - 1),
        pendingCount: action.wasPending
          ? Math.max(0, state.pendingCount - 1)
          : state.pendingCount,
      };
    case "RESOLVE_ITEM":
      return { ...state, pendingCount: Math.max(0, state.pendingCount - 1) };
    case "FAIL_ITEM":
      return { ...state, pendingCount: Math.max(0, state.pendingCount - 1) };
    case "RETRY_ITEM":
      return { ...state, pendingCount: state.pendingCount + 1 };
    case "SET_SAVING":
      return { ...state, isSaving: action.isSaving };
    case "CLEAR":
      return initialState;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function BatchScanProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const itemsRef = useRef<BatchItem[]>([]);
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const inFlightRef = useRef(0);
  const lookupQueueRef = useRef<{ id: string; barcode: string }[]>([]);

  const getItems = useCallback(() => [...itemsRef.current], []);

  // Process the next queued lookup when a slot opens
  const processQueue = useCallback(() => {
    while (
      inFlightRef.current < MAX_CONCURRENT_LOOKUPS &&
      lookupQueueRef.current.length > 0
    ) {
      const next = lookupQueueRef.current.shift()!;
      void performLookup(next.id, next.barcode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const performLookup = useCallback(
    async (itemId: string, barcode: string) => {
      const controller = new AbortController();
      abortControllersRef.current.set(itemId, controller);
      inFlightRef.current++;

      try {
        const res = await apiRequest(
          "GET",
          `/api/nutrition/barcode/${encodeURIComponent(barcode)}`,
        );
        if (controller.signal.aborted) return;

        const data = await res.json();

        // Update item in ref
        const idx = itemsRef.current.findIndex((i) => i.id === itemId);
        if (idx !== -1) {
          const item = itemsRef.current[idx];
          const resolved: ResolvedBatchItem = {
            id: item.id,
            barcode: item.barcode,
            productName: data.productName || item.productName,
            brandName: data.brandName || item.brandName,
            servingSize: data.servingSize || item.servingSize,
            quantity: item.quantity,
            status: "resolved",
            calories: Number(data.calories) || 0,
            protein: Number(data.protein) || 0,
            carbs: Number(data.carbs) || 0,
            fat: Number(data.fat) || 0,
          };
          itemsRef.current[idx] = resolved;
        }

        dispatch({ type: "RESOLVE_ITEM" });
      } catch {
        if (controller.signal.aborted) return;

        const idx = itemsRef.current.findIndex((i) => i.id === itemId);
        if (idx !== -1) {
          const item = itemsRef.current[idx];
          itemsRef.current[idx] = {
            id: item.id,
            barcode: item.barcode,
            productName: item.productName,
            brandName: item.brandName,
            servingSize: item.servingSize,
            quantity: item.quantity,
            status: "error",
            errorMessage: "Nutrition lookup failed",
          };
        }

        dispatch({ type: "FAIL_ITEM" });
      } finally {
        abortControllersRef.current.delete(itemId);
        inFlightRef.current--;
        processQueue();
      }
    },
    [processQueue],
  );

  const startSession = useCallback(() => {
    itemsRef.current = [];
    dispatch({ type: "START_SESSION" });
  }, []);

  const addItemAndLookup = useCallback(
    (barcode: string) => {
      if (itemsRef.current.length >= MAX_ITEMS) return;

      const id = generateItemId();
      const item: BatchItem = {
        id,
        barcode,
        productName: barcode,
        quantity: 1,
        status: "pending",
      };

      itemsRef.current.push(item);
      dispatch({ type: "ADD_ITEM", item });

      if (inFlightRef.current < MAX_CONCURRENT_LOOKUPS) {
        void performLookup(id, barcode);
      } else {
        lookupQueueRef.current.push({ id, barcode });
      }
    },
    [performLookup],
  );

  const incrementQuantity = useCallback((barcode: string) => {
    const item = itemsRef.current.find((i) => i.barcode === barcode);
    if (item && item.quantity < 99) {
      item.quantity += 1;
    }
  }, []);

  const updateItemQuantity = useCallback((id: string, quantity: number) => {
    const clamped = Math.max(1, Math.min(99, quantity));
    const item = itemsRef.current.find((i) => i.id === id);
    if (item) {
      item.quantity = clamped;
    }
  }, []);

  const removeItem = useCallback((id: string) => {
    const controller = abortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(id);
    }

    const item = itemsRef.current.find((i) => i.id === id);
    const wasPending = item?.status === "pending";
    itemsRef.current = itemsRef.current.filter((i) => i.id !== id);
    dispatch({ type: "REMOVE_ITEM", wasPending });
  }, []);

  const retryItem = useCallback(
    (id: string) => {
      const idx = itemsRef.current.findIndex((i) => i.id === id);
      if (idx === -1) return;
      const item = itemsRef.current[idx];
      if (!item.barcode) return;

      itemsRef.current[idx] = {
        id: item.id,
        barcode: item.barcode,
        productName: item.productName,
        brandName: item.brandName,
        servingSize: item.servingSize,
        quantity: item.quantity,
        status: "pending",
      };

      dispatch({ type: "RETRY_ITEM" });
      void performLookup(id, item.barcode);
    },
    [performLookup],
  );

  const clearSession = useCallback(() => {
    for (const controller of abortControllersRef.current.values()) {
      controller.abort();
    }
    abortControllersRef.current.clear();
    lookupQueueRef.current = [];
    inFlightRef.current = 0;
    itemsRef.current = [];
    dispatch({ type: "CLEAR" });
  }, []);

  const setSaving = useCallback((saving: boolean) => {
    dispatch({ type: "SET_SAVING", isSaving: saving });
  }, []);

  const value = useMemo<BatchScanContextValue>(
    () => ({
      itemCount: state.itemCount,
      pendingCount: state.pendingCount,
      isSaving: state.isSaving,
      getItems,
      startSession,
      addItemAndLookup,
      incrementQuantity,
      updateItemQuantity,
      removeItem,
      retryItem,
      clearSession,
      setSaving,
    }),
    [
      state,
      getItems,
      startSession,
      addItemAndLookup,
      incrementQuantity,
      updateItemQuantity,
      removeItem,
      retryItem,
      clearSession,
      setSaving,
    ],
  );

  return (
    <BatchScanContext.Provider value={value}>
      {children}
    </BatchScanContext.Provider>
  );
}

export function useBatchScan(): BatchScanContextValue {
  const context = useContext(BatchScanContext);
  if (!context) {
    throw new Error("useBatchScan must be used within a BatchScanProvider");
  }
  return context;
}
