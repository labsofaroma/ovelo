import { Row, Themes } from "../../stories/helpers";
import { Checkbox } from "./Checkbox";

export default { title: "Primitives/Checkbox" };

export const Default = () => (
  <Row label="States">
    <Checkbox label="Unchecked" />
    <Checkbox label="Checked" defaultChecked />
    <Checkbox label="Indeterminate" indeterminate />
  </Row>
);
export const Focus = () => <Checkbox label="Focused" autoFocus />;
export const Disabled = () => (
  <Row label="Disabled">
    <Checkbox label="Off" disabled />
    <Checkbox label="On" disabled defaultChecked />
  </Row>
);
export const Invalid = () => (
  <Checkbox label="Accept the sample terms" required />
);
export const LightAndDark = () => (
  <Themes>
    <Row label="States">
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultChecked />
      <Checkbox label="Disabled" disabled />
    </Row>
  </Themes>
);
