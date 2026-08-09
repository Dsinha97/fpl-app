// AES-256-GCM at rest for the one secret this app ever stores server-side —
// the owner's pasted FPL session (supabase/functions/fpl-session). Web
// Crypto is native to the Deno Edge runtime, so no external crypto package
// is needed. FPL_SESSION_ENC_KEY is a 32-byte key, base64-encoded, set as an
// Edge Function secret (never checked in, never logged).

async function importKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("FPL_SESSION_ENC_KEY");
  if (!raw) throw new Error("FPL_SESSION_ENC_KEY not set");
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) {
    throw new Error("FPL_SESSION_ENC_KEY must decode to exactly 32 bytes (AES-256)");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptSecret(
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importKey();
  // A fresh random IV per encryption, per AES-GCM's own requirement — reused
  // with the same key it stops being confidential.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return { ciphertext: toBase64(new Uint8Array(cipherBuf)), iv: toBase64(iv) };
}

export async function decryptSecret(ciphertext: string, iv: string): Promise<string> {
  const key = await importKey();
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext),
  );
  return new TextDecoder().decode(plainBuf);
}
