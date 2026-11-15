"use client";

import { Button } from "@ovelo/ui";
import { useSigner } from "../../wallet/context";
import { pnlCopy } from "../copy";
import { useCsvExport } from "../useCsvExport";

/** "Download CSV": signed by the connected wallet, served for that wallet only. */
export function ExportCsv() {
  const exporter = useCsvExport(useSigner());
  if (!exporter.available) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        onClick={exporter.run}
        loading={exporter.busy}
        title={pnlCopy.exportHint}
      >
        {pnlCopy.export}
      </Button>
      {exporter.error ? (
        <p role="alert" className="text-caption text-down">
          {exporter.error}
        </p>
      ) : null}
    </div>
  );
}
