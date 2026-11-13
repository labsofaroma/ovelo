import { AutoFocus, Themes } from "../../stories/helpers";
import { SocialLinks } from "./SocialLinks";

export default { title: "Domain/SocialLinks" };

export const Default = () => <SocialLinks />;
export const Focus = () => (
  <AutoFocus>
    <SocialLinks />
  </AutoFocus>
);
export const LightAndDark = () => (
  <Themes>
    {(theme) => <SocialLinks label={`Aroma community (${theme})`} />}
  </Themes>
);
