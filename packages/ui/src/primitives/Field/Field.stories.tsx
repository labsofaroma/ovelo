import { Themes } from "../../stories/helpers";
import { Input } from "../Input";
import { Select } from "../Select";
import { Field } from "./Field";

export default { title: "Primitives/Field" };

export const Default = () => (
  <Field label="Wallet label" hint="Only you can see this." className="w-72">
    <Input placeholder="Sample text" />
  </Field>
);
export const WithError = () => (
  <Field
    label="Amount"
    hint="Use whole units."
    error="Enter an amount above zero."
    className="w-72"
  >
    <Input defaultValue="0" />
  </Field>
);
export const Required = () => (
  <Field label="Email" required className="w-72">
    <Input type="email" required />
  </Field>
);
export const Disabled = () => (
  <Field label="Locked field" disabled className="w-72">
    <Input defaultValue="Read only sample" />
  </Field>
);
export const WithSelect = () => (
  <Field label="Pay with" className="w-72">
    <Select
      options={[
        { value: "a", label: "Sample token A" },
        { value: "b", label: "Sample token B" },
      ]}
      placeholder="Choose"
    />
  </Field>
);
export const LightAndDark = () => (
  <Themes>
    <Field
      label="Amount"
      hint="Use whole units."
      error="Enter an amount above zero."
    >
      <Input defaultValue="0" />
    </Field>
  </Themes>
);
