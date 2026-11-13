import { Themes } from "../../stories/helpers";
import { Button } from "../Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";

export default { title: "Primitives/Card" };

const Sample = () => (
  <Card className="w-80">
    <CardHeader>
      <CardTitle>Sample basket</CardTitle>
      <CardDescription>
        Demo layout only. No real allocation is shown.
      </CardDescription>
    </CardHeader>
    <CardContent>Content area</CardContent>
    <CardFooter>
      <Button size="sm">Action</Button>
    </CardFooter>
  </Card>
);
export const Default = () => <Sample />;
export const LightAndDark = () => (
  <Themes>
    <Sample />
  </Themes>
);
