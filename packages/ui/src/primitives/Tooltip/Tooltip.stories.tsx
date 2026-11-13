import { Info } from "lucide-react";
import { IconButton } from "../IconButton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./Tooltip";

export default { title: "Primitives/Tooltip" };

const Sample = ({ defaultOpen = false }: { defaultOpen?: boolean }) => (
  <TooltipProvider delay={0}>
    <div className="flex min-h-24 items-end">
      <Tooltip defaultOpen={defaultOpen}>
        <TooltipTrigger
          render={
            <IconButton
              aria-label="About this figure"
              icon={<Info size={18} />}
              variant="secondary"
            />
          }
        />
        <TooltipContent>Sample hint text</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);
export const Default = () => <Sample />;
export const Open = () => <Sample defaultOpen />;
