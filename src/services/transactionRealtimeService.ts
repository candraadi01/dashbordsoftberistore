import { supabase } from "@/lib/supabase";
import { RealtimePostgresChangesPayload, RealtimeChannel } from "@supabase/supabase-js";
import { TransactionRow } from "@/types";

export type TransactionRealtimeCallback = (
  payload: RealtimePostgresChangesPayload<TransactionRow>
) => void;

let channelCounter = 0;
const subscribers = new Set<TransactionRealtimeCallback>();
let sharedChannel: RealtimeChannel | null = null;
let pollIntervalTimer: ReturnType<typeof setInterval> | null = null;
const knownTransactionTimestamps = new Map<string, string>(); // id -> updated_at / created_at
const recentlyDispatchedEvents = new Map<string, number>(); // eventKey -> timestamp

function dispatchPayload(payload: RealtimePostgresChangesPayload<TransactionRow>) {
  const data = (payload.new || payload.old) as Partial<TransactionRow> | undefined;
  if (data?.id) {
    const status = data.status || "";
    const stamp = data.updated_at || data.created_at || "";
    const eventKey = `${payload.eventType}:${data.id}:${status}:${stamp}`;
    const now = Date.now();
    const last = recentlyDispatchedEvents.get(eventKey);
    if (last && now - last < 6000) return; // Deduplicate within 6 seconds
    recentlyDispatchedEvents.set(eventKey, now);

    // Keep cache tidy
    for (const [k, t] of recentlyDispatchedEvents) {
      if (now - t > 60000) recentlyDispatchedEvents.delete(k);
    }
  }

  for (const cb of subscribers) {
    try {
      cb(payload);
    } catch (err) {
      console.warn("[Realtime] Subscriber error:", err);
    }
  }
}

async function checkLatestTransactions() {
  if (subscribers.size === 0) return;
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(15);

    if (error || !data) return;

    // First run initialize timestamps without firing
    if (knownTransactionTimestamps.size === 0) {
      for (const row of data) {
        knownTransactionTimestamps.set(row.id, row.updated_at || row.created_at || "");
      }
      return;
    }

    // Check for new or updated records
    for (const row of data) {
      const prevStamp = knownTransactionTimestamps.get(row.id);
      const currentStamp = row.updated_at || row.created_at || "";

      if (!prevStamp) {
        // Brand new insert!
        knownTransactionTimestamps.set(row.id, currentStamp);
        dispatchPayload({
          schema: "public",
          table: "transactions",
          commit_timestamp: new Date().toISOString(),
          eventType: "INSERT",
          new: row as TransactionRow,
          old: {},
          errors: [],
        } as unknown as RealtimePostgresChangesPayload<TransactionRow>);
      } else if (prevStamp !== currentStamp) {
        // Status or data updated!
        knownTransactionTimestamps.set(row.id, currentStamp);
        dispatchPayload({
          schema: "public",
          table: "transactions",
          commit_timestamp: new Date().toISOString(),
          eventType: "UPDATE",
          new: row as TransactionRow,
          old: { id: row.id },
          errors: [],
        } as unknown as RealtimePostgresChangesPayload<TransactionRow>);
      }
    }
  } catch (err) {
    console.warn("[Realtime] Fallback poll error:", err);
  }
}

function ensureSharedSubscription() {
  if (!sharedChannel) {
    try {
      const channelName = `transactions-realtime-hub-${++channelCounter}`;
      sharedChannel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "transactions",
          },
          (payload) => {
            const row = (payload.new || payload.old) as TransactionRow;
            if (row?.id) {
              knownTransactionTimestamps.set(row.id, row.updated_at || row.created_at || "");
            }
            dispatchPayload(payload as RealtimePostgresChangesPayload<TransactionRow>);
          }
        )
        .subscribe((status, err) => {
          if (err) {
            console.warn(`[Realtime] Hub channel warning:`, err);
          }
        });
    } catch (err) {
      console.warn("[Realtime] Failed to initialize realtime channel:", err);
    }
  }

  if (!pollIntervalTimer && typeof window !== "undefined") {
    // Initial fetch to seed known IDs
    void checkLatestTransactions();
    // Active polling fallback every 4.5 seconds
    pollIntervalTimer = setInterval(() => {
      void checkLatestTransactions();
    }, 4500);
  }
}

function tearDownIfEmpty() {
  if (subscribers.size === 0) {
    if (pollIntervalTimer) {
      clearInterval(pollIntervalTimer);
      pollIntervalTimer = null;
    }
    if (sharedChannel) {
      try {
        supabase.removeChannel(sharedChannel);
      } catch {
        // ignore
      }
      sharedChannel = null;
    }
  }
}

export const transactionRealtimeService = {
  subscribeTransactions(callback: TransactionRealtimeCallback): RealtimeChannel {
    subscribers.add(callback);
    ensureSharedSubscription();

    return {
      unsubscribe: () => {
        subscribers.delete(callback);
        tearDownIfEmpty();
      },
    } as unknown as RealtimeChannel;
  },

  unsubscribe(channel: RealtimeChannel) {
    if (channel && typeof channel.unsubscribe === "function") {
      try {
        channel.unsubscribe();
      } catch (e) {
        console.error("[Realtime] Error unsubscribing:", e);
      }
    }
  },

  /**
   * Helper to manually trigger an update across all listeners (e.g. after local status update)
   */
  notifyLocalChange(row: TransactionRow, eventType: "INSERT" | "UPDATE" = "UPDATE") {
    knownTransactionTimestamps.set(row.id, row.updated_at || row.created_at || "");
    dispatchPayload({
      schema: "public",
      table: "transactions",
      commit_timestamp: new Date().toISOString(),
      eventType,
      new: row,
      old: { id: row.id },
      errors: [],
    } as unknown as RealtimePostgresChangesPayload<TransactionRow>);
  },
};
