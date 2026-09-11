import { supabase } from "@/lib/supabase";
import { RealtimePostgresChangesPayload, RealtimeChannel } from "@supabase/supabase-js";
import { TransactionRow } from "@/types";

export type TransactionRealtimeCallback = (
  payload: RealtimePostgresChangesPayload<TransactionRow>
) => void;

let channelCounter = 0;

export const transactionRealtimeService = {
  subscribeTransactions(callback: TransactionRealtimeCallback): RealtimeChannel {
    try {
      // Each subscriber gets a unique channel name to prevent Supabase from
      // silently overwriting an existing subscription with the same name.
      const uniqueChannelName = `transactions-changes-${++channelCounter}-${Date.now()}`;
      const channel = supabase
        .channel(uniqueChannelName)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "transactions",
          },
          callback
        )
        .subscribe((status, err) => {
          if (err) {
            console.error(`[Realtime] Channel ${uniqueChannelName} error:`, err);
          }
          if (status === "CHANNEL_ERROR") {
            console.warn(`[Realtime] Channel ${uniqueChannelName} encountered an error. Will auto-retry.`);
          }
        });

      return channel;
    } catch (e) {
      console.error("[Realtime] Failed to create channel:", e);
      return {
        unsubscribe: () => {},
      } as unknown as RealtimeChannel;
    }
  },

  unsubscribe(channel: RealtimeChannel) {
    if (channel) {
      try {
        supabase.removeChannel(channel);
      } catch (e) {
        console.error("[Realtime] Error unsubscribing:", e);
      }
    }
  }
};
