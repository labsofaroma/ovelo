import { Button } from "../Button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "./Popover";

export default { title: "Primitives/Popover" };

const Sample = ({ defaultOpen = false }: { defaultOpen?: boolean }) => (
  <div className="flex min-h-48 items-start">
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger
        render={<Button variant="secondary">Data source</Button>}
      />
      <PopoverContent>
        <PopoverTitle className="font-semibold">Source</PopoverTitle>
        <PopoverDescription className="mt-1 text-muted">
          Sample note about where a figure comes from and when it was observed.
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  </div>
);
export const Default = () => <Sample />;
export const Open = () => <Sample defaultOpen />;
