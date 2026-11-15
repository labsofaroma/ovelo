"use client";

import { Button } from "@ovelo/ui";
import { settingsCopy } from "../copy";
import { BETA_CHANNELS, type NotifyConfigView } from "../schema";
import type { useNotifications } from "../useNotifications";
import { ChannelCard } from "./ChannelCard";

type State = Omit<ReturnType<typeof useNotifications>, "config"> & {
  config: {
    data?: NotifyConfigView | undefined;
    isPending: boolean;
    isError: boolean;
  };
};

/** The Notifications section's view: pure props, so it is tested without a wallet or network. */
export function NotificationsPanel({
  wallet,
  canSign,
  state,
}: {
  wallet: string | null;
  canSign: boolean;
  state: State;
}) {
  const config = state.config.data;
  const channels = BETA_CHANNELS.filter(
    (c) => config?.[c] !== null && config?.[c] !== undefined,
  );
  return (
    <div className="flex flex-col gap-3 text-small">
      <p className="text-muted">{settingsCopy.intro}</p>
      {state.config.isPending ? null : !config || state.config.isError ? (
        <p className="text-muted">{settingsCopy.noChannels}</p>
      ) : !config.enabled ? (
        <p className="text-muted">{settingsCopy.disabled}</p>
      ) : channels.length === 0 ? (
        <p className="text-muted">{settingsCopy.noChannels}</p>
      ) : !wallet ? (
        <p className="text-muted">{settingsCopy.connectFirst}</p>
      ) : !canSign ? (
        <p className="text-muted">{settingsCopy.cannotSign}</p>
      ) : !state.open ? (
        <div className="flex flex-col items-start gap-2">
          <Button onClick={state.actions.open} loading={state.busy === "open"}>
            {settingsCopy.open}
          </Button>
          <p className="text-muted">{settingsCopy.openHint}</p>
        </div>
      ) : (
        <>
          {channels.map((channel) => (
            <ChannelCard
              key={channel}
              channel={channel}
              subscription={
                state.subscriptions.find((s) => s.channel === channel) ?? null
              }
              telegramLink={channel === "telegram" ? state.telegramLink : null}
              busy={state.busy}
              actions={state.actions}
            />
          ))}
          <div>
            <Button
              variant="ghost"
              onClick={state.actions.deleteAll}
              loading={state.busy === "delete"}
            >
              {settingsCopy.deleteAll}
            </Button>
          </div>
        </>
      )}
      {state.notice ? <p role="status">{state.notice}</p> : null}
      {state.error ? (
        <p role="alert" className="text-down">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
