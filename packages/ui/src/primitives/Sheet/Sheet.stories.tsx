import { Button } from "../Button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  type SheetSide,
} from "./Sheet";

export default { title: "Primitives/Sheet" };

const Sample = ({
  side,
  defaultOpen = false,
}: {
  side?: SheetSide;
  defaultOpen?: boolean;
}) => (
  <Sheet defaultOpen={defaultOpen}>
    <SheetTrigger
      render={<Button variant="secondary">Open {side ?? "right"} sheet</Button>}
    />
    <SheetContent side={side}>
      <SheetTitle>Filters</SheetTitle>
      <SheetDescription>Demo panel. Narrow the sample list.</SheetDescription>
    </SheetContent>
  </Sheet>
);
export const Default = () => <Sample />;
export const OpenRight = () => <Sample defaultOpen />;
export const OpenBottom = () => <Sample side="bottom" defaultOpen />;
export const OpenLeft = () => <Sample side="left" defaultOpen />;
