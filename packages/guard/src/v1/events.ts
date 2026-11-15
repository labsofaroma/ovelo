/**
 * Ovelo Guard v1 events from transaction logs. Anchor's `emit!` writes `Program data: <base64>`.
 * Only lines logged while THIS program is the one executing count: the invoke stack is tracked
 * from the runtime's `Program <id> invoke [n]` / `success` / `failed` lines, so another program
 * in the same transaction cannot forge an event.
 */
import type { Address } from "@solana/kit";
import { OVELO_GUARD_V1_PROGRAM_ID } from "./constants";
import {
  INSTALLMENT_EXECUTED_EVENT_DISCRIMINATOR,
  PLAN_CLOSED_EVENT_DISCRIMINATOR,
  PLAN_CREATED_EVENT_DISCRIMINATOR,
  parseInstallmentExecutedEvent,
  parsePlanClosedEvent,
  parsePlanCreatedEvent,
  type InstallmentExecutedEvent,
  type PlanClosedEvent,
  type PlanCreatedEvent,
} from "./generated";

export type OveloGuardEvent =
  | { name: "InstallmentExecuted"; data: InstallmentExecutedEvent }
  | { name: "PlanCreated"; data: PlanCreatedEvent }
  | { name: "PlanClosed"; data: PlanClosedEvent };

const INVOKE = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[(\d+)\]$/;
const EXIT = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (success|failed)/;
const DATA = "Program data: ";

function base64Bytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const startsWith = (data: Uint8Array, prefix: ArrayLike<number>) =>
  data.length >= prefix.length &&
  Array.prototype.every.call(
    prefix,
    (byte: number, i: number) => data[i] === byte,
  );

function decodeOne(data: Uint8Array): OveloGuardEvent | null {
  try {
    if (startsWith(data, INSTALLMENT_EXECUTED_EVENT_DISCRIMINATOR))
      return {
        name: "InstallmentExecuted",
        data: parseInstallmentExecutedEvent(data),
      };
    if (startsWith(data, PLAN_CREATED_EVENT_DISCRIMINATOR))
      return { name: "PlanCreated", data: parsePlanCreatedEvent(data) };
    if (startsWith(data, PLAN_CLOSED_EVENT_DISCRIMINATOR))
      return { name: "PlanClosed", data: parsePlanClosedEvent(data) };
  } catch {
    return null;
  }
  return null;
}

/** Plan events emitted by `programId` (default: v1) in a transaction's log messages, in order. */
export function decodeOveloGuardEvents(
  logs: readonly string[] | null | undefined,
  programId: Address = OVELO_GUARD_V1_PROGRAM_ID,
): OveloGuardEvent[] {
  const stack: string[] = [];
  const events: OveloGuardEvent[] = [];
  for (const line of logs ?? []) {
    const invoke = INVOKE.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    const exit = EXIT.exec(line);
    if (exit) {
      if (stack.at(-1) === exit[1]) stack.pop();
      continue;
    }
    if (!line.startsWith(DATA) || stack.at(-1) !== programId) continue;
    const bytes = base64Bytes(line.slice(DATA.length).trim());
    const event = bytes ? decodeOne(bytes) : null;
    if (event) events.push(event);
  }
  return events;
}

export function installmentEvents(
  logs: readonly string[] | null | undefined,
  programId?: Address,
): InstallmentExecutedEvent[] {
  return decodeOveloGuardEvents(logs, programId).flatMap((e) =>
    e.name === "InstallmentExecuted" ? [e.data] : [],
  );
}
