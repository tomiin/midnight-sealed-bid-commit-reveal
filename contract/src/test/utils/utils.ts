export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const toHexPadded = (str: string, len = 64) =>
  Buffer.from(str, "ascii").toString("hex").padStart(len, "0");

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  Buffer.from(a).equals(Buffer.from(b));
