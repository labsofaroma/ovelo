import { Themes } from "../../stories/helpers";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./Table";

export default { title: "Primitives/Table" };

const Sample = () => (
  <Table>
    <TableCaption>Sample rows. Demo values, not market data.</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead scope="col">Asset</TableHead>
        <TableHead scope="col" className="text-right">
          Weight
        </TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>Demo asset A</TableCell>
        <TableCell className="text-right">60.00%</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Demo asset B</TableCell>
        <TableCell className="text-right">40.00%</TableCell>
      </TableRow>
    </TableBody>
  </Table>
);
export const Default = () => <Sample />;
export const LightAndDark = () => (
  <Themes>
    <Sample />
  </Themes>
);
