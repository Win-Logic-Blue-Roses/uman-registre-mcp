// Vérification des jetons d'accès OAuth émis par Supabase Auth (serveur OAuth 2.1 du projet U-MAN Art).
// Jetons JWT signés en ES256 ; clés publiques lues sur le JWKS du projet, gardées en mémoire 10 minutes.
// La base revérifie chaque jeton (PostgREST) : ce contrôle sert à répondre 401 tout de suite et à connaître
// le compte et l'application cliente (client_id) pour le suivi.

const DUREE_CACHE_MS = 10 * 60 * 1000;
let cache = { cles: null, expire: 0, url: "" };

const b64url = (s) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const json = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

export class JetonInvalide extends Error {}

async function cles(jwksUrl, chercher = fetch) {
  if (cache.cles && cache.url === jwksUrl && Date.now() < cache.expire) return cache.cles;
  const r = await chercher(jwksUrl, { cf: { cacheTtl: 600 } });
  if (!r.ok) throw new Error(`JWKS indisponible (${r.status})`);
  const { keys } = await r.json();
  cache = { cles: keys ?? [], expire: Date.now() + DUREE_CACHE_MS, url: jwksUrl };
  return cache.cles;
}

/** Vide le cache des clés (tests, rotation de clé). */
export const oublierCles = () => { cache = { cles: null, expire: 0, url: "" }; };

/**
 * Vérifie un jeton et rend ses revendications. Exige : ES256, clé connue, signature, émetteur, rôle
 * « authenticated », jeton non expiré et émis par le serveur OAuth (client_id présent).
 */
export async function verifierJeton(jeton, { emetteur, jwksUrl, chercher = fetch, maintenant = Date.now() }) {
  const parts = (jeton ?? "").split(".");
  if (parts.length !== 3) throw new JetonInvalide("format");
  let entete, charge;
  try { entete = json(parts[0]); charge = json(parts[1]); } catch { throw new JetonInvalide("format"); }
  if (entete.alg !== "ES256") throw new JetonInvalide("algorithme");

  let jwk = (await cles(jwksUrl, chercher)).find((k) => k.kid === entete.kid);
  if (!jwk) {                                   // rotation de clé : on relit le JWKS une fois
    oublierCles();
    jwk = (await cles(jwksUrl, chercher)).find((k) => k.kid === entete.kid);
  }
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") throw new JetonInvalide("cle_inconnue");

  const cle = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, cle, b64url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new JetonInvalide("signature");

  const s = Math.floor(maintenant / 1000);
  if (typeof charge.exp !== "number" || charge.exp <= s) throw new JetonInvalide("expire");
  if (typeof charge.nbf === "number" && charge.nbf > s + 60) throw new JetonInvalide("pas_encore_valide");
  if (charge.iss !== emetteur) throw new JetonInvalide("emetteur");
  if (charge.role !== "authenticated" || !charge.sub) throw new JetonInvalide("role");
  if (!charge.client_id) throw new JetonInvalide("pas_un_jeton_oauth");
  return charge;
}
