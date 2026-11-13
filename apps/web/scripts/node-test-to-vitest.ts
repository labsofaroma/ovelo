/* eslint-disable no-console -- CLI: reports to stdout/stderr */
/**
 * Converts a node:test + node:assert file to Vitest (M2 port helper).
 *   pnpm --filter @aroma/web exec tsx scripts/node-test-to-vitest.ts <in> <out>
 * Mechanical only: assert.* calls become expect(), node:test becomes vitest, CommonJS
 * require() becomes import. Anything it cannot convert safely is left as-is and listed, so the
 * result never silently drops an assertion. Review the output and fix import paths by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node-test-to-vitest.ts <in> <out>");
  process.exit(2);
}
const source = readFileSync(input, "utf8");
const sf = ts.createSourceFile(
  input,
  source,
  ts.ScriptTarget.Latest,
  true,
  input.endsWith(".ts") || input.endsWith(".mjs")
    ? ts.ScriptKind.TS
    : ts.ScriptKind.JS,
);

type Edit = { start: number; end: number; text: string };
const edits: Edit[] = [];
const unconverted: string[] = [];
const text = (n: ts.Node) => n.getText(sf);

function convertAssert(call: ts.CallExpression): string | null {
  const callee = call.expression;
  let name: string | null = null;
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "assert"
  )
    name = callee.name.text;
  else if (ts.isIdentifier(callee) && callee.text === "assert") name = "ok";
  if (!name) return null;
  const a = call.arguments.map(text);
  const [x, y] = a;
  switch (name) {
    case "equal":
    case "strictEqual":
      return y === undefined || x === undefined
        ? null
        : `expect(${x}${a[2] ? `, ${a[2]}` : ""}).toBe(${y})`;
    case "notEqual":
    case "notStrictEqual":
      return x && y ? `expect(${x}).not.toBe(${y})` : null;
    case "deepEqual":
    case "deepStrictEqual":
      return x && y
        ? `expect(${x}${a[2] ? `, ${a[2]}` : ""}).toEqual(${y})`
        : null;
    case "notDeepEqual":
    case "notDeepStrictEqual":
      return x && y ? `expect(${x}).not.toEqual(${y})` : null;
    case "match":
      return x && y ? `expect(${x}).toMatch(${y})` : null;
    case "doesNotMatch":
      return x && y ? `expect(${x}).not.toMatch(${y})` : null;
    case "ok":
      return x ? `expect(${x}).toBeTruthy()` : null;
    case "throws":
      return x ? `expect(${x}).toThrow(${y && /^\//.test(y) ? y : ""})` : null;
    case "rejects":
      return x
        ? `await expect(${x}).rejects.toThrow(${y && /^\//.test(y) ? y : ""})`
        : null;
    default:
      return null;
  }
}

function visit(n: ts.Node): void {
  if (ts.isCallExpression(n)) {
    const converted = convertAssert(n);
    if (converted) {
      // Extra non-regex validators/messages would change meaning; keep those for manual review.
      const name = ts.isPropertyAccessExpression(n.expression)
        ? n.expression.name.text
        : "ok";
      const second = n.arguments[1];
      const needsManual =
        (name === "throws" || name === "rejects") &&
        second &&
        !/^\//.test(text(second));
      if (needsManual)
        unconverted.push(
          `line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${text(n).slice(0, 80)}`,
        );
      else {
        edits.push({ start: n.getStart(), end: n.getEnd(), text: converted });
        return;
      }
    } else if (
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "assert"
    ) {
      unconverted.push(
        `line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${text(n).slice(0, 80)}`,
      );
    }
  }
  ts.forEachChild(n, visit);
}

for (const stmt of sf.statements) {
  const t = text(stmt);
  if (
    /^import\s+(assert|test)\s+from\s+["']node:(assert(\/strict)?|test)["'];?$/.test(
      t,
    ) ||
    /^import\s+\{[^}]*\}\s+from\s+["']node:test["'];?$/.test(t) ||
    /^const\s+(\{[^}]*\}|assert|test)\s*=\s*require\(["']node:(assert(\/strict)?|test)["']\);?$/.test(
      t,
    )
  ) {
    edits.push({ start: stmt.getStart(), end: stmt.getEnd(), text: "" });
    continue;
  }
  if (
    ts.isVariableStatement(stmt) &&
    stmt.declarationList.declarations.length === 1
  ) {
    const d = stmt.declarationList.declarations[0]!;
    const init = d.initializer;
    if (
      init &&
      ts.isCallExpression(init) &&
      ts.isIdentifier(init.expression) &&
      init.expression.text === "require" &&
      init.arguments[0] &&
      ts.isStringLiteral(init.arguments[0])
    ) {
      const spec = init.arguments[0].text;
      const binding = ts.isObjectBindingPattern(d.name)
        ? text(d.name).replace(/(\w+)\s*:\s*(\w+)/g, "$1 as $2")
        : `* as ${text(d.name)}`;
      edits.push({
        start: stmt.getStart(),
        end: stmt.getEnd(),
        text: `import ${binding} from ${JSON.stringify(spec)};`,
      });
    }
  }
}
visit(sf);

edits.sort((a, b) => b.start - a.start);
let out = source;
for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
const header = `import { expect, test } from "vitest";\n`;
writeFileSync(output, header + out.replace(/^\s+/, ""));
console.log(`${input} -> ${output}: ${edits.length} edits`);
if (unconverted.length) {
  console.log(`NOT CONVERTED (${unconverted.length}), fix by hand:`);
  for (const u of unconverted) console.log("  " + u);
}
