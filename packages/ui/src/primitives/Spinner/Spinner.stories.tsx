import { Row, Themes } from "../../stories/helpers";
import { Spinner } from "./Spinner";

export default { title: "Primitives/Spinner" };

export const Default = () => (
  <Row label="Sizes">
    <Spinner size="sm" />
    <Spinner />
    <Spinner size="lg" />
  </Row>
);
export const Loading = () => (
  <p className="flex items-center gap-2 text-small text-muted">
    <Spinner size="sm" label="Fetching sample data" /> Fetching sample data
  </p>
);
export const LightAndDark = () => (
  <Themes>
    <Spinner />
  </Themes>
);
