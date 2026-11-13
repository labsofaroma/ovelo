"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { IconButton } from "@aroma/ui";

type Theme = "light" | "dark";
/** Same key as the prototype ThemeProvider and `themeInitScript`, so a choice carries over. */
const KEY = "aroma-theme";

function current(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Light/dark switch. Storage can be blocked (private mode, policy): the toggle still works per page. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(current()), []);

  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <IconButton
      variant="ghost"
      aria-label={theme ? `Switch to ${next} theme` : "Switch theme"}
      icon={
        theme === "light" ? (
          <Moon aria-hidden="true" className="size-4" />
        ) : (
          <Sun aria-hidden="true" className="size-4" />
        )
      }
      onClick={() => {
        const value = current() === "light" ? "dark" : "light";
        document.documentElement.dataset.theme = value;
        document.documentElement.style.colorScheme = value;
        try {
          window.localStorage.setItem(KEY, value);
        } catch {
          // Storage unavailable: keep the choice for this page only.
        }
        setTheme(value);
      }}
    />
  );
}
