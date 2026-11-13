/** Test-only helpers (not exported from the package index). */
// Test-only Borsh encoding from the pinned program IDL, independent of the validating reader.
import { JUPITER_EXACT_IN_IDL as idl } from "./idl/exact-in";

/** Loosely-typed IDL shapes: just what the encoder walks (the IDL constant is a literal). */
type IdlType =
  | string
  | { option: IdlType }
  | { vec: IdlType }
  | { array: [IdlType, number] }
  | { defined: { name: string } };
interface IdlField {
  name: string;
  type: IdlType;
}
interface IdlTypeDef {
  kind: string;
  fields?: IdlField[];
  variants?: { name: string; fields?: IdlField[] }[];
}
interface IdlInstruction {
  name: string;
  discriminator: number[];
  args: IdlField[];
  accounts: {
    name: string;
    address?: string;
    signer?: boolean;
    writable?: boolean;
  }[];
}
type Value = unknown;
type Fields = Record<string, Value>;
const typeDefs = idl.types as unknown as Record<string, IdlTypeDef>;
const instructions = idl.instructions as unknown as IdlInstruction[];

const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
function unsigned(value: Value, bytes: number): Buffer {
  const out = Buffer.alloc(bytes);
  let n = BigInt((value ?? 0) as bigint | number | string);
  for (let i = 0; i < bytes; i++) {
    out[i] = Number(n & 255n);
    n >>= 8n;
  }
  return out;
}
function fields(list: IdlField[], value: Fields = {}): Buffer {
  return Buffer.concat(list.map((f) => encode(f.type, value[f.name])));
}
function encode(type: IdlType, value: Value): Buffer {
  if (typeof type === "string") {
    if (/^u(8|16|32|64|128)$/.test(type))
      return unsigned(value, Number(type.slice(1)) / 8);
    if (type === "bool") return Buffer.from([value ? 1 : 0]);
    if (type === "bytes") {
      const bytes = Buffer.from((value ?? []) as number[]);
      return Buffer.concat([unsigned(bytes.length, 4), bytes]);
    }
    throw new Error(`Unsupported fixture type ${type}`);
  }
  if ("option" in type)
    return value == null
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), encode(type.option, value)]);
  if ("vec" in type) {
    const values = (value ?? []) as Value[];
    return Buffer.concat([
      unsigned(values.length, 4),
      ...values.map((v) => encode(type.vec, v)),
    ]);
  }
  if ("array" in type) {
    const items = (value ?? []) as Value[];
    return Buffer.concat(
      Array.from({ length: type.array[1] }, (_, i) =>
        encode(type.array[0], items[i]),
      ),
    );
  }
  const definition = typeDefs[type.defined.name];
  if (!definition) throw new Error(`Unknown fixture type ${type.defined.name}`);
  if (definition.kind === "struct")
    return fields(definition.fields ?? [], value as Fields);
  const variants = definition.variants ?? [];
  const name =
    (value as { variant?: string } | undefined)?.variant ?? variants[0]?.name;
  const index = variants.findIndex((v) => v.name === name);
  if (index < 0) throw new Error("Unknown fixture variant");
  return Buffer.concat([
    Buffer.from([index]),
    fields(variants[index]?.fields ?? [], value as Fields),
  ]);
}
export interface JupiterInstructionOptions {
  kind?: string;
  signer: string;
  source: string;
  destination: string;
  inputMint: string;
  outputMint: string;
  inputTokenProgram?: string;
  outputTokenProgram?: string;
  amount?: string;
  out?: string;
  slippage?: number;
  args?: Fields;
  swap?: Fields;
}

/** Shape of a Jupiter API instruction as the validator consumes it. */
export interface TestApiInstruction {
  programId: string;
  data: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
}

function testJupiterInstruction({
  kind = "route_v2",
  signer,
  source,
  destination,
  inputMint,
  outputMint,
  inputTokenProgram = TOKEN,
  outputTokenProgram = TOKEN,
  amount = "1000000",
  out = "1000000",
  slippage = 100,
  args = {},
  swap = { variant: "RaydiumCP" },
}: JupiterInstructionOptions): TestApiInstruction {
  const shape = instructions.find((i) => i.name === kind);
  if (!shape) throw new Error(`Unknown fixture instruction ${kind}`);
  const values = {
    id: 0,
    in_amount: BigInt(amount),
    quoted_out_amount: BigInt(out),
    slippage_bps: slippage,
    platform_fee_bps: 0,
    positive_slippage_bps: 0,
    route_plan: [
      { swap, percent: 100, bps: 10000, input_index: 0, output_index: 1 },
    ],
    ...args,
  };
  const addresses: Record<string, string> = {
    user_transfer_authority: signer,
    user_source_token_account: source,
    source_token_account: source,
    user_destination_token_account: destination,
    destination_token_account: destination,
    source_mint: inputMint,
    destination_mint: outputMint,
    token_program: inputTokenProgram,
    source_token_program: inputTokenProgram,
    destination_token_program: outputTokenProgram,
    program: JUPITER,
  };
  return {
    programId: JUPITER,
    data: Buffer.concat([
      Buffer.from(shape.discriminator),
      fields(shape.args, values),
    ]).toString("base64"),
    accounts: shape.accounts.map((a) => ({
      pubkey: a.address ?? addresses[a.name] ?? JUPITER,
      isSigner: a.signer ?? false,
      isWritable: a.writable ?? false,
    })),
  };
}
export { testJupiterInstruction, encode };
