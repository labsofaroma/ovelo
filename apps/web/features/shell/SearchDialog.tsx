"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ovelo/ui";
import { routes } from "../shared/routes";
import { shell } from "./copy";

/** ⌘K search: hands the query to the markets list (`/markets?q=`), which filters real listings. */
export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    onOpenChange(false);
    router.push(
      q ? `${routes.markets}?q=${encodeURIComponent(q)}` : routes.markets,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-ui="v2" className="flex flex-col gap-4">
        <DialogTitle className="font-display text-title">
          {shell.search.title}
        </DialogTitle>
        <DialogDescription className="text-small text-muted">
          {shell.search.hint}
        </DialogDescription>
        <form
          role="search"
          action={routes.markets}
          onSubmit={submit}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <label className="sr-only" htmlFor="shell-search">
            {shell.search.label}
          </label>
          <div className="flex min-h-11 flex-1 items-center gap-3 rounded-full border border-border-strong bg-raised px-4 focus-within:ring-2 focus-within:ring-focus">
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
            <input
              id="shell-search"
              name="q"
              type="search"
              autoComplete="off"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={shell.search.placeholder}
              className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-muted"
            />
          </div>
          <Button type="submit">{shell.search.submit}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
