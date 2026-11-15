"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Signer } from "../wallet/context";
import { notifyApi } from "./api";
import { settingsCopy } from "./copy";
import {
  browserPushSubscription,
  dropBrowserPush,
  pushSupported,
} from "./push";
import type { BetaChannel, NotifyEvent, SubscriptionView } from "./schema";

type Events = Exclude<NotifyEvent, "test">[];

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";
const isAuth = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "UNAUTHORIZED";

/**
 * Notification settings state for one wallet. The session token lives in memory only (no
 * cookie, no storage): reloading the page asks for a new signature. Every signature request is
 * the user's click; nothing signs on its own.
 */
export function useNotifications(signer: Signer | null) {
  const config = useQuery({
    queryKey: ["notify-config"],
    queryFn: notifyApi.config,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const [token, setToken] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionView[]>([]);
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sign = useCallback(
    async (message: string) => {
      if (!signer?.signMessage) throw new Error(settingsCopy.cannotSign);
      return toBase64(
        await signer.signMessage(new TextEncoder().encode(message)),
      );
    },
    [signer],
  );

  const run = useCallback(
    async (label: string, task: () => Promise<void>) => {
      setBusy(label);
      setError(null);
      setNotice(null);
      try {
        await task();
      } catch (cause) {
        if (isAuth(cause) && token) {
          setToken(null);
          setError(settingsCopy.sessionEnded);
        } else setError(errorText(cause));
      } finally {
        setBusy(null);
      }
    },
    [token],
  );

  const open = () =>
    run("open", async () => {
      if (!signer) return;
      const challenge = await notifyApi.challenge({
        purpose: "notify-manage",
        wallet: signer.address,
      });
      const session = await notifyApi.session({
        wallet: signer.address,
        nonce: challenge.nonce,
        signature: await sign(challenge.message),
      });
      setToken(session.token);
      setSubscriptions(session.subscriptions);
    });

  const upsert = (view: SubscriptionView) =>
    setSubscriptions((list) => [
      ...list.filter((s) => s.channel !== view.channel),
      view,
    ]);

  const turnOn = (channel: BetaChannel, events: Events) =>
    run(`on:${channel}`, async () => {
      if (!signer) return;
      let push;
      if (channel === "push") {
        const key = config.data?.push?.publicKey;
        if (!key || !pushSupported())
          throw new Error(settingsCopy.pushUnsupported);
        const subscription = await browserPushSubscription(key);
        if (subscription === "denied") throw new Error(settingsCopy.pushDenied);
        push = subscription;
      }
      const challenge = await notifyApi.challenge({
        purpose: "notify-subscribe",
        wallet: signer.address,
        channel,
        events,
        ...(push ? { endpoint: push.endpoint } : {}),
      });
      const result = await notifyApi.subscribe({
        wallet: signer.address,
        nonce: challenge.nonce,
        signature: await sign(challenge.message),
        channel,
        events,
        ...(push ? { push } : {}),
      });
      setToken(result.token);
      upsert(result.subscription);
      setTelegramLink(result.telegramLink);
    });

  const refresh = () =>
    run("refresh", async () => {
      if (token) setSubscriptions((await notifyApi.list(token)).subscriptions);
    });

  const saveEvents = (channel: BetaChannel, events: Events) =>
    run(`save:${channel}`, async () => {
      if (token) upsert(await notifyApi.setEvents(token, channel, events));
    });

  const test = (channel: BetaChannel) =>
    run(`test:${channel}`, async () => {
      if (!token) return;
      await notifyApi.test(token, channel);
      setNotice(settingsCopy.testSent);
    });

  const turnOff = (channel: BetaChannel) =>
    run(`off:${channel}`, async () => {
      if (!token) return;
      await notifyApi.remove(token, channel);
      if (channel === "push") await dropBrowserPush();
      if (channel === "telegram") setTelegramLink(null);
      setSubscriptions((list) => list.filter((s) => s.channel !== channel));
    });

  const deleteAll = () =>
    run("delete", async () => {
      if (!token) return;
      await notifyApi.removeAll(token);
      await dropBrowserPush();
      setSubscriptions([]);
      setTelegramLink(null);
      setNotice(settingsCopy.deleted);
    });

  return {
    config,
    open: token !== null,
    subscriptions,
    telegramLink,
    busy,
    error,
    notice,
    actions: { open, turnOn, refresh, saveEvents, test, turnOff, deleteAll },
  };
}
