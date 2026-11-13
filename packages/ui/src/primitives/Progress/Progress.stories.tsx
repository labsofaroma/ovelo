import { Themes } from "../../stories/helpers";
import { Progress } from "./Progress";

export default { title: "Primitives/Progress" };

export const Default = () => (
  <Progress label="Sample progress" value={40} showValue className="w-72" />
);
export const Complete = () => (
  <Progress label="Complete" value={100} showValue className="w-72" />
);
export const Loading = () => (
  <Progress
    aria-label="Confirming sample transaction"
    value={null}
    className="w-72"
  />
);
export const LightAndDark = () => (
  <Themes>
    <Progress label="Sample progress" value={65} showValue />
    <Progress aria-label="Indeterminate" value={null} />
  </Themes>
);
