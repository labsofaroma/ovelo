import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AssetAvatar,
  Badge,
  Brand,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Change,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@aroma/ui";
import { NextAvatarImage } from "./NextAvatarImage";

// Read the flag per request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UI preview",
  robots: { index: false, follow: false },
};

// Sample rows only. Nothing here is market data, and the page says so.
const DEMO_ROWS = [
  { symbol: "AAPLx", name: "Demo row one", change: 123n },
  { symbol: "DEMO2", name: "Demo row two", change: -250n },
  { symbol: "DEMO3", name: "Demo row three", change: 0n },
] as const;

/**
 * M1 wiring proof: a server component rendering @aroma/ui through the Tailwind v4 entry.
 * A design-system preview: never served on a production deployment (M9).
 */
export default function UiPreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 bg-bg p-6 text-ink">
      <header className="flex items-center justify-between">
        <Brand LinkComponent={Link} />
        <Badge tone="warning">Demo values only</Badge>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>@aroma/ui preview</CardTitle>
          <CardDescription>
            Rendered by a server component through the Tailwind v4 entry.
            Figures are demo values, not market data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableCaption>Sample rows (demo values)</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Asset</TableHead>
                <TableHead scope="col" className="text-right">
                  Change
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_ROWS.map((row) => (
                <TableRow key={row.symbol}>
                  <TableCell>
                    <span className="flex items-center gap-3">
                      <AssetAvatar
                        asset={{ symbol: row.symbol }}
                        ImageComponent={NextAvatarImage}
                      />
                      {row.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Change percent={{ value: row.change, decimals: 2 }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex gap-3">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
      </div>
    </main>
  );
}
