import { Row, Themes } from "../../stories/helpers";
import { AssetAvatar } from "./AssetAvatar";

export default { title: "Domain/AssetAvatar" };

const Avatars = () => (
  <div className="flex flex-col gap-4">
    <Row label="Bundled issuer logo, three sizes">
      <AssetAvatar asset={{ symbol: "AAPLx" }} size="sm" label="Apple" />
      <AssetAvatar asset={{ symbol: "AAPLx" }} label="Apple" />
      <AssetAvatar asset={{ symbol: "AAPLx" }} size="lg" label="Apple" />
    </Row>
    <Row label="Deterministic fallback tiles (no logo available)">
      <AssetAvatar asset={{ symbol: "DEMO1" }} />
      <AssetAvatar asset={{ symbol: "DEMO2" }} />
      <AssetAvatar asset={{ symbol: "DEMO3" }} />
      <AssetAvatar asset={{ symbol: "DEMO4" }} size="lg" />
      <AssetAvatar asset={{ symbol: "DEMO5" }} size="sm" />
    </Row>
    <Row label="Broken URL falls back (unsafe URL refused)">
      <AssetAvatar asset={{ symbol: "NOPE", logoUrl: "javascript:alert(1)" }} />
    </Row>
  </div>
);
export const Default = () => <Avatars />;
export const LightAndDark = () => (
  <Themes>
    <Avatars />
  </Themes>
);
