import { AutoFocus, Row, Themes } from "../../stories/helpers";
import { Brand } from "./Brand";

export default { title: "Domain/Brand" };

const Lockups = () => (
  <div className="flex flex-col gap-4">
    <Row label="Horizontal (default)">
      <Brand />
    </Row>
    <Row label="Stacked">
      <Brand variant="stacked" />
    </Row>
    <Row label="Glyph and wordmark only">
      <Brand variant="glyph" />
      <Brand variant="wordmark" />
    </Row>
    <Row label="Static (no link)">
      <Brand asStatic />
    </Row>
  </div>
);
export const Default = () => <Lockups />;
export const Focus = () => (
  <Row label="Keyboard focus ring">
    <AutoFocus>
      <Brand />
    </AutoFocus>
  </Row>
);
export const OnBackground = () => (
  <Themes>
    <Lockups />
  </Themes>
);
