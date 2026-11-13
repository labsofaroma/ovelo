import { LogOut, Settings, User } from "lucide-react";
import { Button } from "../Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";

export default { title: "Primitives/DropdownMenu" };

const Sample = ({ defaultOpen = false }: { defaultOpen?: boolean }) => (
  <div className="flex min-h-72 items-start">
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        render={<Button variant="secondary">Account menu</Button>}
      />
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel className="px-3 py-2 text-caption font-semibold text-muted">
            Sample account
          </DropdownMenuGroupLabel>
          <DropdownMenuItem>
            <User size={16} aria-hidden="true" /> Profile
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Settings size={16} aria-hidden="true" /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem disabled>Activity (unavailable)</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <LogOut size={16} aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);
export const Default = () => <Sample />;
export const Open = () => <Sample defaultOpen />;
