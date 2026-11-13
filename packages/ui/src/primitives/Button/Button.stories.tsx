import { Plus } from "lucide-react";
import { Row, Themes } from "../../stories/helpers";
import { Button } from "./Button";

export default { title: "Primitives/Button" };

export const Default = () => (
  <Row label="Variants">
    <Button>Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="danger">Danger</Button>
  </Row>
);
export const Sizes = () => (
  <Row label="Sizes">
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
    <Button>
      <Plus size={16} aria-hidden="true" /> With icon
    </Button>
  </Row>
);
export const Focus = () => (
  <Row label="Keyboard focus ring">
    <Button autoFocus>Focused</Button>
  </Row>
);
export const Disabled = () => (
  <Row label="Disabled">
    <Button disabled>Primary</Button>
    <Button disabled variant="secondary">
      Secondary
    </Button>
    <Button disabled variant="ghost">
      Ghost
    </Button>
  </Row>
);
export const Loading = () => (
  <Row label="Loading (blocks activation, stays focusable)">
    <Button loading>Saving</Button>
    <Button loading variant="secondary">
      Saving
    </Button>
  </Row>
);
export const FullWidth = () => <Button fullWidth>Full width</Button>;
export const LightAndDark = () => (
  <Themes>
    <Row label="Variants">
      <Button>Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button disabled>Disabled</Button>
      <Button loading>Loading</Button>
    </Row>
  </Themes>
);
