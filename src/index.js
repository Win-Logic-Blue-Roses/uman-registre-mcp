// MCP distant du registre U-MAN Art « Processus humain documenté » (https://mcp.u-man.art/mcp).
//
// Transport « Streamable HTTP » de MCP, sans état : chaque POST porte un message JSON-RPC et reçoit une réponse JSON.
// Autorisation OAuth 2.1 (spécification MCP) : ce serveur est une « ressource protégée » (RFC 9728) dont le serveur
// d'autorisation est Supabase Auth, celui des comptes U-MAN Art. L'assistant (Claude, ChatGPT…) s'inscrit seul
// (enregistrement dynamique), l'artiste se connecte sur u-man.art et autorise l'accès ; le jeton reçu agit en son nom.

import { verifierJeton, JetonInvalide } from "./jeton.js";
import { base, ErreurOutil } from "./base.js";
import { OUTILS } from "./outils.js";

export const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SERVEUR = { name: "uman-registre", title: "Registre U-MAN Art", version: "1.0.0", websiteUrl: "https://u-man.art/registre/" };
const CONSIGNES = "Registre « Processus humain documenté » de U-MAN Art (groupe Win-Logic). Il documente le processus de création d'une œuvre faite par un humain ; ce n'est ni une certification ni une expertise. "
  + "Parcours : mes_credits, mes_oeuvres, preparer_dossier, ajouter_piece (2 pièces au moins), puis soumettre_dossier. "
  + "L'envoi coûte un crédit ou une œuvre du forfait : montrez toujours le coût et les deux déclarations à l'artiste et attendez son accord explicite. "
  + "N'inventez jamais une étape ou une pièce : tout vient de l'artiste. Aucune IA générative n'est acceptée au registre, même en usage secondaire.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Protocol-Version",
};
const json = (corps, statut = 200, entetes = {}) => new Response(JSON.stringify(corps), {
  status: statut, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...entetes },
});

const ressource = (url) => `${url.origin}/mcp`;
const metadonnees = (url, env) => ({
  resource: ressource(url),
  authorization_servers: [`${env.SUPABASE_URL}/auth/v1`],
  bearer_methods_supported: ["header"],
  resource_name: "Registre U-MAN Art",
  resource_documentation: "https://github.com/Win-Logic-Blue-Roses/uman-registre-mcp",
});

function refus(url, erreur = "invalid_token") {
  const meta = `${url.origin}/.well-known/oauth-protected-resource/mcp`;
  return json({ error: erreur, error_description: "Connectez votre compte U-MAN Art." }, 401, {
    "WWW-Authenticate": `Bearer resource_metadata="${meta}"${erreur === "invalid_token" ? `, error="invalid_token"` : ""}`,
  });
}

const reponse = (id, result) => ({ jsonrpc: "2.0", id, result });
const erreur = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Traite un message JSON-RPC ; rend null pour une notification. */
export async function traiter(msg, ctx) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return erreur(msg?.id, -32600, "Requête JSON-RPC invalide.");
  const notification = msg.id === undefined || msg.id === null;
  if (notification) return null;
  switch (msg.method) {
    case "initialize": {
      const demandee = msg.params?.protocolVersion;
      return reponse(msg.id, {
        protocolVersion: VERSIONS.includes(demandee) ? demandee : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVEUR,
        instructions: CONSIGNES,
      });
    }
    case "ping": return reponse(msg.id, {});
    case "tools/list":
      return reponse(msg.id, { tools: OUTILS.map(({ faire, ...o }) => o) });
    case "tools/call": {
      const outil = OUTILS.find((o) => o.name === msg.params?.name);
      if (!outil) return erreur(msg.id, -32602, `Outil inconnu : ${msg.params?.name}`);
      const debut = Date.now();
      try {
        const r = await outil.faire(ctx.db, msg.params?.arguments ?? {}, ctx);
        ctx.journal({ outil: outil.name, ok: true, ms: Date.now() - debut });
        return reponse(msg.id, { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r });
      } catch (e) {
        if (!(e instanceof ErreurOutil)) { console.error(outil.name, e?.stack ?? e); e = new ErreurOutil("erreur_interne", "Erreur inattendue. Réessayez dans un instant."); }
        ctx.journal({ outil: outil.name, ok: false, code: e.code, ms: Date.now() - debut });
        const r = { erreur: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) };
        return reponse(msg.id, { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r, isError: true });
      }
    }
    default: return erreur(msg.id, -32601, `Méthode non prise en charge : ${msg.method}`);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp") {
      return json(metadonnees(url, env), 200, { "Cache-Control": "public, max-age=3600" });
    }
    // Clients plus anciens (MCP 2025-03-26) : métadonnées du serveur d'autorisation cherchées sur l'hôte du MCP.
    if (p === "/.well-known/oauth-authorization-server" || p === "/.well-known/oauth-authorization-server/mcp") {
      const r = await fetch(`${env.SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1`, { cf: { cacheTtl: 3600 } });
      return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...CORS } });
    }
    if (p === "/" || p === "") return Response.redirect("https://github.com/Win-Logic-Blue-Roses/uman-registre-mcp", 302);
    if (p !== "/mcp") return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });

    const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
    if (!m) return refus(url, "unauthorized");
    let jeton;
    try {
      jeton = await verifierJeton(m[1], { emetteur: `${env.SUPABASE_URL}/auth/v1`, jwksUrl: `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json` });
    } catch (e) {
      if (e instanceof JetonInvalide) return refus(url);
      console.error("jwks", e?.stack ?? e);
      return json({ error: "temporarily_unavailable" }, 503, { "Retry-After": "30" });
    }

    if (env.LIMITE) {
      const { success } = await env.LIMITE.limit({ key: jeton.sub });
      if (!success) return json(erreur(null, -32000, "Trop de requêtes : 60 par minute au plus."), 429, { "Retry-After": "60" });
    }

    let corps;
    try { corps = await request.json(); } catch { return json(erreur(null, -32700, "JSON invalide."), 400); }
    // Suivi : compte, application cliente et outil, dans les journaux du Worker (jamais le contenu des dossiers).
    const journal = (x) => console.log(JSON.stringify({ suivi: "mcp", compte: jeton.sub, client: jeton.client_id, ...x }));
    const ctx = { db: base(env, m[1]), jeton: m[1], chercher: fetch, journal };

    const lot = Array.isArray(corps);
    const reponses = (await Promise.all((lot ? corps : [corps]).map((x) => traiter(x, ctx)))).filter(Boolean);
    if (!reponses.length) return new Response(null, { status: 202, headers: CORS });
    return json(lot ? reponses : reponses[0], 200, { "Mcp-Protocol-Version": request.headers.get("mcp-protocol-version") ?? VERSIONS[0] });
  },
};
