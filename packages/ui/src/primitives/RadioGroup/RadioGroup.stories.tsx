import { Themes } from "../../stories/helpers";
import { RadioGroup, RadioGroupItem } from "./RadioGroup";

export default { title: "Primitives/RadioGroup" };

const Sample = () => (
  <RadioGroup aria-label="Practice mode" defaultValue="paper">
    <RadioGroupItem value="mainnet" label="Mainnet spot" />
    <RadioGroupItem value="paper" label="Paper practice" />
    <RadioGroupItem value="devnet" label="Devnet recurring" disabled />
  </RadioGroup>
);
export const Default = () => <Sample />;
export const Disabled = () => <Sample />;
export const LightAndDark = () => (
  <Themes>
    <Sample />
  </Themes>
);
