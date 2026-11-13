import { Button } from "../Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";

export default { title: "Primitives/Dialog" };

const Sample = ({ defaultOpen = false }: { defaultOpen?: boolean }) => (
  <Dialog defaultOpen={defaultOpen}>
    <DialogTrigger render={<Button variant="secondary">Open dialog</Button>} />
    <DialogContent>
      <DialogTitle>Close sample plan?</DialogTitle>
      <DialogDescription>
        Demo copy. Closing a plan would revoke its approval.
      </DialogDescription>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost">Cancel</Button>} />
        <Button variant="danger">Close plan</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
export const Default = () => <Sample />;
export const Open = () => <Sample defaultOpen />;
