"use client";

import { Badge, Button, Checkbox } from "@aroma/ui";
import { useEffect, useState } from "react";
import { eventLabel, settingsCopy } from "../copy";
import {
  NOTIFY_EVENTS,
  type BetaChannel,
  type SubscriptionView,
} from "../schema";
import type { useNotifications } from "../useNotifications";

type Events = (typeof NOTIFY_EVENTS)[number][];
type Actions = ReturnType<typeof useNotifications>["actions"];

/** One channel: its state, which events it receives, and on / off / test. */
export function ChannelCard({
  channel,
  subscription,
  telegramLink,
  busy,
  actions,
}: {
  channel: BetaChannel;
  subscription: SubscriptionView | null;
  telegramLink: string | null;
  busy: string | null;
  actions: Actions;
}) {
  const [events, setEvents] = useState<Events>(
    subscription?.events ?? [
      "trade_confirmed",
      "trade_failed",
      "trade_unconfirmed",
    ],
  );
  useEffect(() => {
    if (subscription) setEvents(subscription.events);
  }, [subscription]);
  const toggle = (event: Events[number], on: boolean) =>
    setEvents((list) =>
      on ? [...new Set([...list, event])] : list.filter((e) => e !== event),
    );
  const status = subscription?.status ?? "off";
  const name = settingsCopy.channel[channel];
  return (
    <section
      aria-label={name}
      className="flex flex-col gap-3 rounded-control border border-line p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{name}</p>
          <p className="text-muted">{settingsCopy.channelHint[channel]}</p>
        </div>
        <Badge
          tone={
            status === "active"
              ? "up"
              : status === "pending"
                ? "warning"
                : "neutral"
          }
        >
          {settingsCopy.status[status]}
        </Badge>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">{`${name}: events`}</legend>
        {NOTIFY_EVENTS.map((event) => (
          <Checkbox
            key={event}
            label={eventLabel[event]}
            checked={events.includes(event)}
            onCheckedChange={(on: boolean) => toggle(event, on)}
          />
        ))}
      </fieldset>
      {channel === "telegram" && status === "pending" && telegramLink ? (
        <div className="flex flex-col items-start gap-2">
          <p>{settingsCopy.telegramStep}</p>
          <a
            href={telegramLink}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent underline"
          >
            {settingsCopy.telegramOpen}
          </a>
          <Button
            variant="ghost"
            size="sm"
            onClick={actions.refresh}
            loading={busy === "refresh"}
          >
            {settingsCopy.checkAgain}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === "off" ? (
          <Button
            onClick={() => actions.turnOn(channel, events)}
            disabled={events.length === 0}
            loading={busy === `on:${channel}`}
          >
            {settingsCopy.turnOn}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => actions.saveEvents(channel, events)}
              disabled={events.length === 0}
              loading={busy === `save:${channel}`}
            >
              {settingsCopy.save}
            </Button>
            {status === "active" ? (
              <Button
                variant="secondary"
                onClick={() => actions.test(channel)}
                loading={busy === `test:${channel}`}
              >
                {settingsCopy.test}
              </Button>
            ) : null}
            <Button
              variant="danger"
              onClick={() => actions.turnOff(channel)}
              loading={busy === `off:${channel}`}
            >
              {settingsCopy.turnOff}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
