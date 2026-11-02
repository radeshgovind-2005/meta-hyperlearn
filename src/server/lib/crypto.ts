// AES-GCM encryption of user API keys with a 32-byte master key (base64).

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function importKey(masterB64: string): Promise<CryptoKey> {
  const raw = unb64(masterB64);
  if (raw.length !== 32) throw new Error("KEY_ENCRYPTION_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, masterB64: string, aad: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await importKey(masterB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plain),
  );
  return { ciphertext: b64(new Uint8Array(ct)), iv: b64(iv) };
}

export async function decryptSecret(ciphertext: string, iv: string, masterB64: string, aad: string): Promise<string> {
  const key = await importKey(masterB64);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(aad) },
    key,
    unb64(ciphertext),
  );
  return new TextDecoder().decode(pt);
}

export function randomId(prefix = ""): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const s = [...bytes].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  return prefix ? `${prefix}_${s}` : s;
}

export function randomToken(): string {
  return b64(crypto.getRandomValues(new Uint8Array(18))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
