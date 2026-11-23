import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const random = () => randomBytes(32).toString("base64url");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const proof = /^[A-Za-z0-9_-]{43}$/;
const digest = /^[a-f0-9]{64}$/;
const sessionName = "sc_private_session";
const stateName = "sc_google_state";
const sessionAge = 30 * 86400;
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

function cookie(req, name) {
  return req.headers.cookie?.split(/;\s*/).find((item) => item.startsWith(name + "="))
    ?.slice(name.length + 1) || "";
}

function setCookie(req, res, name, value, maxAge) {
  const secure = process.env.VERCEL || req.headers["x-forwarded-proto"] === "https";
  const header = name + "=" + value + "; Path=/api; HttpOnly; SameSite=Lax; Max-Age=" +
    maxAge + (secure ? "; Secure" : "");
  res.setHeader("Set-Cookie", [...(res.getHeader("Set-Cookie") || []), header]);
}

export function sameOrigin(req) {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const host = req.headers.host;
  return !!host && (
    req.headers.origin === "https://" + host ||
    (process.env.VERCEL_ENV !== "production" && req.headers.origin === "http://" + host)
  );
}

export function keyAccount(key) {
  if (typeof key !== "string" || !proof.test(key)) return null;
  return { id: sha("key:" + key), method: "key" };
}

function googleConfig(req) {
  const { GOOGLE_CLIENT_ID: client, GOOGLE_CLIENT_SECRET: secret, GOOGLE_REDIRECT_URI } = process.env;
  if (!client || !secret || !GOOGLE_REDIRECT_URI) return null;
  try {
    const redirect = new URL(GOOGLE_REDIRECT_URI);
    if (redirect.host === req.headers.host) return { client, secret, redirect };
  } catch {
    // The private key login remains available for a misconfigured Google client.
  }
  return null;
}

function sign(session, secret) {
  return createHmac("sha256", secret).update("speccraft:google-session:" + session)
    .digest("base64url");
}

export function privateAccount(req) {
  const [method, key, expiry, signature, origin] = cookie(req, sessionName).split(".");
  if (method === "key") return keyAccount(key);
  const config = googleConfig(req);
  if (method !== "google" || !config || !digest.test(key) || !proof.test(signature) ||
      !/^\d{10}$/.test(expiry) || Number(expiry) <= Date.now() / 1000) return null;
  const source = origin === "source";
  const signed = key + "." + expiry + (source ? ".source" : "");
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(signed, config.secret))))
    return null;
  return { id: key, method, source };
}

export function newPrivateKey() {
  return random();
}

export function keySession(req, res, key) {
  setCookie(req, res, sessionName, "key." + key, sessionAge);
}

export function sessionKey(req) {
  return cookie(req, sessionName).split(".")[1];
}

export function clearPrivateSession(req, res) {
  setCookie(req, res, sessionName, "", 0);
}

export const googleAvailable = (req) => Boolean(googleConfig(req));

function redirectTo(res, location) {
  res.setHeader("Location", location);
  return res.status(303).end();
}

export function googleStart(req, res) {
  const config = googleConfig(req);
  if (!config) return redirectTo(res, "/?private-sync=google-unavailable");
  const state = random();
  const verifier = random();
  const nonce = random();
  setCookie(req, res, stateName, [state, verifier, nonce].join("."), 600);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.client,
    redirect_uri: config.redirect.href,
    scope: "openid email",
    prompt: "select_account",
    response_type: "code",
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return redirectTo(res, url.href);
}

export async function googleFinish(req, res, {
  exchange = fetch, keys = googleKeys, initialize = async () => false,
} = {}) {
  const config = googleConfig(req);
  const [state, verifier, nonce] = cookie(req, stateName).split(".");
  setCookie(req, res, stateName, "", 0);
  if (!config || !proof.test(state) || state !== req.query.state ||
      typeof req.query.code !== "string" || !proof.test(verifier) || !proof.test(nonce))
    return redirectTo(res, "/?private-sync=google-failed");
  try {
    const response = await exchange("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.client, client_secret: config.secret,
        code: req.query.code, code_verifier: verifier,
        redirect_uri: config.redirect.href, grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return redirectTo(res, "/?private-sync=google-failed");
    const { id_token: idToken } = await response.json();
    const { payload } = await jwtVerify(idToken, keys, {
      algorithms: ["RS256"], audience: config.client,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      requiredClaims: ["exp", "sub", "nonce"],
    });
    if (payload.nonce !== nonce || typeof payload.sub !== "string" || !payload.sub ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.client) ||
        (payload.azp !== undefined && payload.azp !== config.client))
      return redirectTo(res, "/?private-sync=google-failed");
    const id = sha("google:" + payload.sub);
    const session = id + "." + (Math.floor(Date.now() / 1000) + sessionAge);
    const suffix = await initialize(id) ? ".source" : "";
    setCookie(req, res, sessionName, "google." + session + "." + sign(session + suffix, config.secret) + suffix, sessionAge);
    return redirectTo(res, "/?private-sync=google");
  } catch {
    return redirectTo(res, "/?private-sync=google-failed");
  }
}
