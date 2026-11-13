import { Themes } from "../../stories/helpers";
import { Input } from "../Input";
import { Label } from "./Label";

export default { title: "Primitives/Label" };

const Sample = () => (
  <div className="flex flex-col gap-2">
    <Label htmlFor="label-demo" required>
      Wallet label
    </Label>
    <Input id="label-demo" required placeholder="Sample text" />
  </div>
);
export const Default = () => <Sample />;
export const LightAndDark = () => (
  <Themes>
    <Sample />
  </Themes>
);
