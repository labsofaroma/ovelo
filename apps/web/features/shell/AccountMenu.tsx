"use client";

import Link from "next/link";
import {
  ChevronsUpDown,
  FileText,
  Rocket,
  Settings2,
  UserRound,
  Wallet2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuAnchorItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@ovelo/ui";
import { routes } from "../shared/routes";
import { shell } from "./copy";

/**
 * Account links, opening upward from the sidebar footer. It does not load the wallet stack (v1
 * loads it inside trade surfaces only); connecting happens on the pages that trade.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={shell.account.open}
        className={cn(
          "flex min-h-12 cursor-pointer items-center gap-3 rounded-full border border-line bg-raised-2 text-left focus-ring hover:border-border-strong",
          compact ? "size-11 justify-center p-0" : "w-full px-2 pr-3",
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-pill border-pill">
          <UserRound className="size-4 text-muted" aria-hidden />
        </span>
        {!compact && (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-small font-medium text-ink">
                {shell.account.title}
              </span>
              <span className="text-micro text-muted">
                {shell.account.hint}
              </span>
            </span>
            <ChevronsUpDown className="size-4 text-muted" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-ui="v2"
        side={compact ? "bottom" : "top"}
        align={compact ? "end" : "start"}
      >
        <div className="flex flex-col gap-1 px-3 pt-2 pb-3">
          <p className="font-display text-title text-ink">
            {shell.account.title}
          </p>
          <p className="text-caption text-muted">{shell.account.prompt}</p>
          <p className="text-caption text-muted">{shell.account.custody}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuAnchorItem render={<Link href={routes.getStarted} />}>
          <Rocket className="size-4" aria-hidden />
          {shell.account.getStarted}
        </DropdownMenuAnchorItem>
        <DropdownMenuAnchorItem render={<Link href={routes.portfolio} />}>
          <Wallet2 className="size-4" aria-hidden />
          {shell.account.portfolio}
        </DropdownMenuAnchorItem>
        <DropdownMenuAnchorItem render={<Link href={routes.settings} />}>
          <Settings2 className="size-4" aria-hidden />
          {shell.account.settings}
        </DropdownMenuAnchorItem>
        <DropdownMenuAnchorItem render={<Link href={routes.terms} />}>
          <FileText className="size-4" aria-hidden />
          {shell.account.terms}
        </DropdownMenuAnchorItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
