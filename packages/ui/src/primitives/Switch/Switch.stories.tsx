import { Row, Themes } from "../../stories/helpers";
import { Switch } from "./Switch";

export default { title: "Primitives/Switch" };

export const Default = () => (
  <Row label="States">
    <Switch label="Off" />
    <Switch label="On" defaultChecked />
  </Row>
);
export const Focus = () => <Switch label="Focused" autoFocus />;
export const Disabled = () => (
  <Row label="Disabled">
    <Switch label="Off" disabled />
    <Switch label="On" disabled defaultChecked />
  </Row>
);
export const LightAndDark = () => (
  <Themes>
    <Row label="States">
      <Switch label="Off" />
      <Switch label="On" defaultChecked />
    </Row>
  </Themes>
);
