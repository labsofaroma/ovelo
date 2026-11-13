import { Row, Themes } from "../../stories/helpers";
import { Change } from "./Change";

export default { title: "Domain/Change" };

const pct = (value: bigint, decimals = 2) => ({ value, decimals });

const States = () => (
  <div className="flex flex-col gap-4">
    <Row label="Up / down / flat (sample percentages)">
      <Change percent={pct(123n)} />
      <Change percent={pct(-250n)} />
      <Change percent={pct(0n)} />
    </Row>
    <Row label="Negative zero rounds to flat">
      <Change percent={pct(-1n, 6)} />
    </Row>
    <Row label="Unavailable (honest empty state)">
      <Change percent={null} />
    </Row>
    <Row label="With amount (demo values)">
      <Change
        percent={pct(-52n)}
        amount={{ value: -1_250_000n, decimals: 6, symbol: "$" }}
      />
      <Change amount={{ value: 3_500_000n, decimals: 6, symbol: "$" }} />
    </Row>
    <Row label="Extremes">
      <Change percent={pct(99_999_999_999_999_999_999_949n, 4)} />
      <Change percent={pct(1n, 18)} percentDigits={18} />
    </Row>
  </div>
);
export const Default = () => <States />;
export const LightAndDark = () => (
  <Themes>
    <States />
  </Themes>
);
