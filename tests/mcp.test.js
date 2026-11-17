import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { verifierJeton, JetonInvalide, oublierCles } from "../src/jeton.js";
import { traiter } from "../src/index.js";
import { OUTILS, coutEnvoi, formatFichier } from "../src/outils.js";
import worker from "../src/index.js";

const EMETTEUR = "https://exemple.supabase.co/auth/v1";
const JWKS = `${EMETTEUR}/.well-known/jwks.json`;
const b64url = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", paire.publicKey)), kid: "k1", alg: "ES256" };
const jwksFetch = async () => new Response(JSON.stringify({ keys: [jwk] }));

async function signer(charge, entete = { alg: "ES256", kid: "k1", typ: "JWT" }, cle = paire.privateKey) {
  const t = `${b64url(entete)}.${b64url(charge)}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cle, new TextEncoder().encode(t));
  return `${t}.${Buffer.from(sig).toString("base64url")}`;
}
const valide = () => ({ iss: EMETTEUR, sub: "u1", role: "authenticated", aud: "authenticated", client_id: "c1", exp: Math.floor(Date.now() / 1000) + 600 });
const verifier = (j) => verifierJeton(j, { emetteur: EMETTEUR, jwksUrl: JWKS, chercher: jwksFetch });

beforeEach(() => oublierCles());

test("jeton OAuth valide accepté", async () => {
  const c = await verifier(await signer(valide()));
  assert.equal(c.sub, "u1");
  assert.equal(c.client_id, "c1");
});

for (const [cas, modif] of [
  ["expiré", { exp: 1 }],
  ["mauvais émetteur", { iss: "https://autre.supabase.co/auth/v1" }],
  ["anonyme", { role: "anon" }],
  ["session navigateur (sans client_id)", { client_id: undefined }],
]) {
  test(`jeton refusé : ${cas}`, async () => {
    await assert.rejects(verifier(await signer({ ...valide(), ...modif })), JetonInvalide);
  });
}

test("jeton refusé : signé par une autre clé, ou en HS256", async () => {
  const autre = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  await assert.rejects(verifier(await signer(valide(), undefined, autre.privateKey)), JetonInvalide);
  const [h, c, s] = (await signer(valide())).split(".");
  await assert.rejects(verifier(`${b64url({ alg: "HS256", kid: "k1" })}.${c}.${s}`), JetonInvalide);
  await assert.rejects(verifier(`${h}.${b64url({ ...valide(), sub: "u2" })}.${s}`), JetonInvalide);
});

// ─── Protocole ──────────────────────────────────────────────────────────────

const ctxVide = { db: null, journal: () => {} };

test("initialize : version négociée et capacités", async () => {
  const r = await traiter({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctxVide);
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.ok(r.result.capabilities.tools);
  const r2 = await traiter({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, ctxVide);
  assert.equal(r2.result.protocolVersion, "2025-11-25");
});

test("tools/list sans fonctions internes, notification sans réponse", async () => {
  const r = await traiter({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctxVide);
  assert.ok(r.result.tools.length >= 6);
  for (const t of r.result.tools) { assert.equal(t.faire, undefined); assert.equal(t.inputSchema.type, "object"); }
  assert.equal(await traiter({ jsonrpc: "2.0", method: "notifications/initialized" }, ctxVide), null);
});

test("Worker : 401 avec l'adresse des métadonnées, métadonnées publiées", async () => {
  const env = { SUPABASE_URL: "https://exemple.supabase.co" };
  const r = await worker.fetch(new Request("https://mcp.u-man.art/mcp", { method: "POST", body: "{}" }), env);
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate"), /resource_metadata="https:\/\/mcp\.u-man\.art\/\.well-known\/oauth-protected-resource\/mcp"/);
  const m = await (await worker.fetch(new Request("https://mcp.u-man.art/.well-known/oauth-protected-resource/mcp"), env)).json();
  assert.equal(m.resource, "https://mcp.u-man.art/mcp");
  assert.deepEqual(m.authorization_servers, ["https://exemple.supabase.co/auth/v1"]);
});

// ─── Outils ─────────────────────────────────────────────────────────────────

const outil = (n) => OUTILS.find((o) => o.name === n);
const D = "11111111-1111-4111-8111-111111111111";

function fausseBase(dossier, credits) {
  const appels = [];
  return {
    appels,
    rpc: async (nom, args) => {
      appels.push([nom, args]);
      if (nom === "mes_dossiers") return [dossier];
      if (nom === "mes_credits") return credits;
      if (nom === "registre_dossier_enregistrer") { Object.assign(dossier, args.p); return dossier; }
      if (nom === "registre_dossier_soumettre") return { ...dossier, statut: "soumis" };
      return null;
    },
  };
}

test("coût de l'envoi : forfait, crédit, déjà payé, insuffisant", () => {
  assert.equal(coutEnvoi({ paye_par: "credit" }, {}).mode, "deja_paye");
  assert.equal(coutEnvoi({}, { solde: 0, forfait: { mensuel: 3, utilises: 1 } }).mode, "forfait");
  assert.equal(coutEnvoi({}, { solde: 2, forfait: { mensuel: 3, utilises: 3 } }).mode, "credit");
  assert.equal(coutEnvoi({}, { solde: 0, forfait: null }).mode, "insuffisant");
  const offert = coutEnvoi({}, { solde: 0, forfait: { type: "offert", mensuel: 1, utilises: 0 } });
  assert.equal(offert.mode, "forfait");
  assert.match(offert.texte, /offerte ce mois-ci/);
  assert.equal(coutEnvoi({}, { solde: 0, forfait: { type: "offert", mensuel: 1, utilises: 1 } }).mode, "insuffisant");
  assert.equal(coutEnvoi({ collection_id: "x" }, { solde: 0, forfait: { mensuel: 3, utilises: 0 } }).mode, "collection");
});

test("preparer_dossier ne change que les champs fournis", async () => {
  const d = { id: D, statut: "brouillon", titre: "Avant", createurs: "Ann", declaration: "x".repeat(90), etapes: ["a", "b"] };
  const db = fausseBase(d, {});
  await outil("preparer_dossier").faire(db, { dossier_id: D, technique: "Encre" });
  const [, args] = db.appels.find(([n]) => n === "registre_dossier_enregistrer");
  assert.equal(args.p_id, D);
  assert.equal(args.p.titre, "Avant");
  assert.equal(args.p.technique, "Encre");
  assert.deepEqual(args.p.etapes, ["a", "b"]);
});

test("soumettre_dossier n'envoie rien sans les deux confirmations", async () => {
  const d = { id: D, statut: "brouillon", manques: [] };
  const db = fausseBase(d, { solde: 1 });
  const r = await outil("soumettre_dossier").faire(db, { dossier_id: D, declaration_honneur: true });
  assert.equal(r.envoye, false);
  assert.ok(r.declarations.honneur && r.declarations.renonciation);
  assert.ok(!db.appels.some(([n]) => n === "registre_dossier_soumettre"));
});

test("soumettre_dossier refuse sans crédit, envoie avec accord", async () => {
  const d = { id: D, statut: "brouillon", manques: [] };
  const sans = fausseBase(d, { solde: 0 });
  const r = await outil("soumettre_dossier").faire(sans, { dossier_id: D, declaration_honneur: true, renonciation_retractation: true });
  assert.equal(r.envoye, false);
  assert.equal(r.cout.mode, "insuffisant");
  assert.ok(!sans.appels.some(([n]) => n === "registre_dossier_soumettre"));

  const avec = fausseBase({ ...d }, { solde: 1 });
  const ok = await outil("soumettre_dossier").faire(avec, { dossier_id: D, declaration_honneur: true, renonciation_retractation: true });
  assert.equal(ok.envoye, true);
  const [, args] = avec.appels.find(([n]) => n === "registre_dossier_soumettre");
  assert.deepEqual(args.p_accords, { honneur: true, renonciation: true });
});

test("formats reconnus à la signature", () => {
  const b = (...x) => Uint8Array.from(x);
  const s = (t) => Uint8Array.from(t, (c) => c.charCodeAt(0));
  assert.equal(formatFichier(b(0xff, 0xd8, 0xff, 0xe0)), "jpg");
  assert.equal(formatFichier(Uint8Array.from([0x89, ...s("PNG\r\n")])), "png");
  assert.equal(formatFichier(s("RIFF....WEBPVP8 ")), "webp");
  assert.equal(formatFichier(s("%PDF-1.7")), "pdf");
  assert.equal(formatFichier(s("....ftypisom")), "mp4");
  assert.equal(formatFichier(s("<html>")), null);
});

test("preparer_dossier impose usage_ia = aucun", async () => {
  const d = { id: D, statut: "brouillon", titre: "T", etapes: [] };
  const db = fausseBase(d, {});
  await outil("preparer_dossier").faire(db, { dossier_id: D, usage_ia: "secondaire" });
  const [, args] = db.appels.find(([n]) => n === "registre_dossier_enregistrer");
  assert.equal(args.p.usage_ia, "aucun");
  assert.equal(outil("preparer_dossier").inputSchema.properties.usage_ia, undefined);
});
