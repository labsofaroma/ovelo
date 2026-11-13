import { useState } from "react";
import { AutoFocus } from "../../stories/helpers";
import { Select, type SelectOption } from "./Select";

export default { title: "Primitives/Select" };

const OPTIONS: SelectOption[] = [
  { value: "a", label: "Sample token A", tag: "demo", group: "Group one" },
  { value: "b", label: "Sample token B", tag: "demo", group: "Group one" },
  { value: "c", label: "Sample token C", tag: "demo", group: "Group two" },
  {
    value: "d",
    label: "Unavailable sample",
    disabled: true,
    group: "Group two",
  },
];

export const Default = () => (
  <div className="w-64">
    <Select
      aria-label="Sample select"
      options={OPTIONS}
      placeholder="Choose a sample"
    />
  </div>
);
export const Focus = () => (
  <AutoFocus>
    <div className="w-64">
      <Select aria-label="Focused select" options={OPTIONS} defaultValue="a" />
    </div>
  </AutoFocus>
);
export const Open = () => (
  <div className="min-h-80 w-64">
    <Select
      aria-label="Open select"
      options={OPTIONS}
      defaultOpen
      showTags
      defaultValue="b"
    />
  </div>
);
export const Disabled = () => (
  <div className="w-64">
    <Select
      aria-label="Disabled select"
      options={OPTIONS}
      disabled
      defaultValue="a"
    />
  </div>
);
export const Invalid = () => (
  <div className="w-64">
    <Select aria-label="Invalid select" options={OPTIONS} invalid />
  </div>
);
export const LoadingOpen = () => (
  <div className="min-h-64 w-64">
    <Select
      aria-label="Loading select"
      options={[]}
      defaultOpen
      loading
      emptyMessage="Loading sample options…"
    />
  </div>
);
export const EmptyOpen = () => (
  <div className="min-h-64 w-64">
    <Select
      aria-label="Empty select"
      options={[]}
      defaultOpen
      emptyMessage="No sample options match."
    />
  </div>
);
export const SearchableOpen = () => {
  const [query, setQuery] = useState("");
  const shown = OPTIONS.filter((option) =>
    option.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="min-h-80 w-64">
      <Select
        aria-label="Searchable select"
        options={shown}
        defaultOpen
        search={{
          value: query,
          onChange: setQuery,
          ariaLabel: "Search sample tokens",
          placeholder: "Search",
        }}
      />
    </div>
  );
};
