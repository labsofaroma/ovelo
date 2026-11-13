import { Row, Themes } from "../../stories/helpers";
import { Badge } from "./Badge";

export default { title: "Primitives/Badge" };

export const Default = () => (
  <Row label="Tones (labels name the network or mode, never color alone)">
    <Badge>Paper practice</Badge>
    <Badge tone="accent">Mainnet spot</Badge>
    <Badge tone="warning">Devnet test</Badge>
    <Badge tone="up">Filled</Badge>
    <Badge tone="down">Failed</Badge>
  </Row>
);
export const LightAndDark = () => (
  <Themes>
    <Row label="Tones">
      <Badge>Paper practice</Badge>
      <Badge tone="accent">Mainnet spot</Badge>
      <Badge tone="warning">Devnet test</Badge>
      <Badge tone="up">Filled</Badge>
      <Badge tone="down">Failed</Badge>
    </Row>
  </Themes>
);
