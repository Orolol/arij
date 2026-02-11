import { randomBytes } from "crypto";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const DEFAULT_LENGTH = 21;

export function generateId(length: number = DEFAULT_LENGTH): string {
  const bytes = randomBytes(length);
  let id = "";
  for (let i = 0; i < length; i++) {
    id += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return id;
}

export function generatePrefixedId(
  prefix: string,
  length: number = DEFAULT_LENGTH
): string {
  return `${prefix}_${generateId(length)}`;
}
