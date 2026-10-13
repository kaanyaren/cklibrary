// One-time helper: mint an OAuth access token from the service-account JSON.
// No external deps — uses node's crypto + fetch.
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const saPath = process.env.SA_JSON || "./cklibrary-cb9b1-firebase-adminsdk-fbsvc-b2ee1da5f9.json";
const sa = JSON.parse(readFileSync(saPath, "utf8"));

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

export async function getAccessToken(scope = "https://www.googleapis.com/auth/cloud-platform") {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  const sig = signer.sign(sa.private_key);
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`token error ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = await getAccessToken();
  const r = await fetch(
    "https://firebase.googleapis.com/v1beta1/projects/cklibrary-cb9b1/webApps",
    { headers: { Authorization: `Bearer ${t}` } },
  );
  console.log("webApps status", r.status);
  console.log(JSON.stringify(await r.json(), null, 2));
}
