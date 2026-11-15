"use client";

// Ported from apps/web/components/ui/GlideSelect.tsx (the user's GlideSelect API, built on
// Base UI Select and Combobox). Behaviour kept: grouped options, searchable mode, tags, rich
// option content, loading/empty states, menu header/status/footer, remembered highlight.
// Dropped: per-instance color/duration props; theming now comes only from tokens.
import { Combobox } from "@base-ui/react/combobox";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown, Search } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import {
  controlSurface,
  disabledStyles,
  focusRing,
  popupMotion,
} from "../../lib/styles";
import styles from "./Select.module.css";
import { useGlideHighlight } from "./useGlideHighlight";

export interface SelectOption<Value extends string = string> {
  value: Value;
  label: string;
  tag?: string;
  disabled?: boolean;
  group?: string;
  /** Rich content shown in the list instead of the plain label. */
  content?: ReactNode;
}

export interface SelectSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
}

export interface SelectProps<Value extends string = string> {
  options: readonly SelectOption<Value>[];
  value?: Value;
  defaultValue?: Value;
  onChange?: (value: Value, option: SelectOption<Value>) => void;
  /** Accessible name. Not needed inside <Field>, whose label names the trigger. */
  "aria-label"?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
  className?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerContent?: ReactNode;
  /** Switches to a searchable combobox. Filtering is up to the caller (server or local). */
  search?: SelectSearch;
  menuHeader?: ReactNode;
  menuStatus?: ReactNode;
  menuFooter?: ReactNode;
  emptyMessage?: ReactNode;
  loading?: boolean;
  showTags?: boolean;
  size?: "sm" | "md";
  placement?: "top" | "bottom";
  align?: "left" | "right";
  rememberPosition?: boolean;
}

const itemClass =
  "flex min-h-(--ovelo-control-height) cursor-pointer items-center gap-2 rounded-control px-3 py-2.5 text-small leading-snug outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";
const noteClass = "shrink-0 p-3 text-caption leading-normal text-muted";

export function Select<Value extends string = string>({
  options,
  value,
  defaultValue,
  onChange,
  placeholder = "Select an option",
  disabled = false,
  invalid,
  id,
  name,
  required = false,
  className,
  open,
  defaultOpen,
  onOpenChange,
  triggerContent,
  search,
  menuHeader,
  menuStatus,
  menuFooter,
  emptyMessage = "No options available.",
  loading = false,
  showTags = false,
  size = "md",
  placement = "bottom",
  align = "left",
  rememberPosition = true,
  ...aria
}: SelectProps<Value>) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const searchInput = useRef<HTMLInputElement>(null);
  const glide = useGlideHighlight(rememberPosition);
  const Parts = search ? Combobox : BaseSelect;

  const groups = new Map<string, SelectOption<Value>[]>();
  for (const option of options) {
    const key = option.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }

  const renderItem = (option: SelectOption<Value>) => (
    <Parts.Item
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      className={itemClass}
      {...(!search ? { label: option.label } : {})}
    >
      {search ? (
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {option.content ?? option.label}
        </span>
      ) : (
        <BaseSelect.ItemText className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {option.content ?? option.label}
        </BaseSelect.ItemText>
      )}
      {showTags && option.tag && (
        <span className="text-micro text-muted">{option.tag}</span>
      )}
      <Parts.ItemIndicator className="flex text-accent">
        <Check size={15} aria-hidden="true" />
      </Parts.ItemIndicator>
    </Parts.Item>
  );

  const popup = (
    <Parts.Popup
      className={cn(
        "flex w-max min-w-(--anchor-width) max-w-(--available-width) flex-col overflow-hidden origin-(--transform-origin) max-h-[min(30rem,var(--available-height))]",
        "rounded-control border border-line bg-surface text-ink shadow-float",
        popupMotion,
      )}
      {...(search
        ? { initialFocus: searchInput, "aria-label": search.ariaLabel }
        : {})}
    >
      {search && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line p-3 text-muted">
          <Search size={16} aria-hidden="true" />
          <Combobox.Input
            ref={searchInput}
            aria-label={search.ariaLabel}
            placeholder={search.placeholder ?? "Search options"}
            maxLength={100}
            className={cn(
              controlSurface,
              "w-full min-w-0 px-3 py-2.5 placeholder:text-muted",
              focusRing,
            )}
          />
        </div>
      )}
      {menuHeader && <div className={noteClass}>{menuHeader}</div>}
      {menuStatus && <div className={noteClass}>{menuStatus}</div>}
      <Parts.List
        ref={glide.setList}
        aria-busy={loading || undefined}
        className={cn(
          styles.list,
          "min-h-0 overflow-y-auto overscroll-contain p-1",
        )}
      >
        <span
          aria-hidden="true"
          className={styles.highlight}
          style={{
            height: glide.box?.height ?? 0,
            transform: `translateY(${glide.box?.top ?? 0}px)`,
            opacity: glide.box ? 1 : 0,
          }}
        />
        {[...groups].map(([group, entries]) =>
          group ? (
            <Parts.Group key={group}>
              <Parts.GroupLabel className="px-3 pb-1 pt-3 text-caption font-semibold text-muted">
                {group}
              </Parts.GroupLabel>
              {entries.map(renderItem)}
            </Parts.Group>
          ) : (
            entries.map(renderItem)
          ),
        )}
        {options.length === 0 && (
          // A listbox needs option children (ARIA), so the empty state is an inert option.
          <div
            role="option"
            aria-disabled="true"
            aria-selected="false"
            className={noteClass}
          >
            {emptyMessage}
          </div>
        )}
      </Parts.List>
      {menuFooter && (
        <div className={cn(noteClass, "border-t border-line")}>
          {menuFooter}
        </div>
      )}
    </Parts.Popup>
  );

  const triggerClass = cn(
    controlSurface,
    "inline-flex w-full max-w-full min-w-0 cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left leading-snug",
    "hover:not-disabled:border-ink data-[popup-open]:border-ink data-[invalid]:border-down aria-invalid:border-down",
    size === "sm" &&
      "min-h-(--ovelo-control-height-compact) py-2 max-md:min-h-(--ovelo-control-height)",
    "transition-colors motion-base",
    focusRing,
    disabledStyles,
    className,
  );
  const chevron = (
    <ChevronDown
      size={15}
      aria-hidden="true"
      className="shrink-0 text-muted transition-transform motion-pop group-data-[popup-open]:rotate-180"
    />
  );
  const rootProps = {
    value,
    defaultValue,
    disabled,
    name,
    required,
    open: !disabled && (open ?? internalOpen),
    onOpenChange: (next: boolean) => {
      setInternalOpen(next);
      if (next) glide.onOpen();
      onOpenChange?.(next);
    },
    onValueChange: (next: Value | null) => {
      const option = options.find((item) => item.value === next);
      if (option && !option.disabled) onChange?.(option.value, option);
    },
  };
  const positioner = {
    side: placement,
    align: align === "left" ? ("start" as const) : ("end" as const),
    sideOffset: 6,
    collisionPadding: 8,
    className: "z-popover",
  };
  const triggerProps = {
    id,
    "aria-label": aria["aria-label"],
    "aria-invalid": invalid || undefined,
    className: cn(triggerClass, "group"),
    "data-size": size,
  };

  if (search) {
    return (
      <Combobox.Root<Value>
        {...rootProps}
        items={options.map((option) => option.value)}
        itemToStringLabel={(next) =>
          options.find((o) => o.value === next)?.label ?? next
        }
        filter={null}
        inputValue={search.value}
        onInputValueChange={(next, details) => {
          if (
            details.reason === "input-change" ||
            details.reason === "input-clear"
          )
            search.onChange(next);
        }}
      >
        <Combobox.Trigger {...triggerProps}>
          {triggerContent ?? <Combobox.Value placeholder={placeholder} />}
          {chevron}
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner {...positioner}>{popup}</Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    );
  }

  return (
    <BaseSelect.Root<Value> {...rootProps} items={options}>
      <BaseSelect.Trigger {...triggerProps}>
        {triggerContent ?? (
          <BaseSelect.Value
            placeholder={placeholder}
            className="min-w-0 truncate data-[placeholder]:text-muted"
          />
        )}
        {chevron}
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner {...positioner} alignItemWithTrigger={false}>
          {popup}
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
