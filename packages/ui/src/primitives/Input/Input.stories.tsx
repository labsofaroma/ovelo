import { Row, Themes } from "../../stories/helpers";
import { Input } from "./Input";

export default { title: "Primitives/Input" };

export const Default = () => (
  <div className="flex w-72 flex-col gap-3">
    <Input aria-label="Sample" placeholder="Placeholder text" />
    <Input aria-label="Small" size="sm" placeholder="Small" />
  </div>
);
export const Focus = () => (
  <Input
    className="w-72"
    aria-label="Focused sample"
    autoFocus
    defaultValue="Focused"
  />
);
export const Disabled = () => (
  <Input
    className="w-72"
    aria-label="Disabled sample"
    disabled
    defaultValue="Disabled"
  />
);
export const Invalid = () => (
  <Input
    className="w-72"
    aria-label="Invalid sample"
    invalid
    defaultValue="Not valid"
  />
);
export const LightAndDark = () => (
  <Themes>
    <Row label="States">
      <Input className="w-56" aria-label="Default" placeholder="Default" />
      <Input
        className="w-56"
        aria-label="Invalid"
        invalid
        defaultValue="Invalid"
      />
      <Input
        className="w-56"
        aria-label="Disabled"
        disabled
        defaultValue="Disabled"
      />
    </Row>
  </Themes>
);
