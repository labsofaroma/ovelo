import { Bell, Settings, Star } from "lucide-react";
import { Row, Themes } from "../../stories/helpers";
import { IconButton } from "./IconButton";

export default { title: "Primitives/IconButton" };

export const Default = () => (
  <Row label="Variants (every icon button has an aria-label)">
    <IconButton aria-label="Watch asset" icon={<Star size={18} />} />
    <IconButton
      aria-label="Alerts"
      icon={<Bell size={18} />}
      variant="secondary"
    />
    <IconButton
      aria-label="Settings"
      icon={<Settings size={18} />}
      variant="primary"
    />
  </Row>
);
export const Focus = () => (
  <Row label="Keyboard focus ring">
    <IconButton aria-label="Watch asset" icon={<Star size={18} />} autoFocus />
  </Row>
);
export const Disabled = () => (
  <IconButton aria-label="Settings" icon={<Settings size={18} />} disabled />
);
export const Loading = () => (
  <IconButton aria-label="Refreshing" icon={<Settings size={18} />} loading />
);
export const LightAndDark = () => (
  <Themes>
    <Row label="States">
      <IconButton aria-label="Watch asset" icon={<Star size={18} />} />
      <IconButton
        aria-label="Settings"
        icon={<Settings size={18} />}
        variant="secondary"
      />
      <IconButton aria-label="Alerts" icon={<Bell size={18} />} disabled />
    </Row>
  </Themes>
);
