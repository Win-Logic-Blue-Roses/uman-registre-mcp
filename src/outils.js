// Outils du MCP « Registre U-MAN Art ». Chaque outil appelle les fonctions de la base avec le jeton de l'artiste.
// Rien n'est publié par le MCP : un dossier envoyé est contrôlé par l'équipe de U-MAN Art avant de devenir une fiche.

import { ErreurOutil } from "./base.js";

export const SITE = "https://u-man.art";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID_FICHE = /^UM-[0-9A-HJKMNP-TV-Z]{5}$/;
const TYPES_PIECE = ["croquis", "etape", "calques", "source", "atelier", "autre"];
const TAILLE_MAX = { image: 10 * 1024 * 1024, video: 90 * 1024 * 1024 };

// Textes exacts des deux cases de la page de dépôt : l'assistant doit les montrer à l'artiste avant l'envoi.
export const DECLARATIONS = {
  honneur: "Je déclare sur l'honneur que ces informations sont exactes et que je suis l'auteur de l'œuvre, ou que son auteur m'a autorisé à la déposer.",
  renonciation: "Je demande le contrôle de mon dossier tout de suite. Ce dépôt utilise un crédit (ou une œuvre de mon forfait) : je renonce à mon droit de rétractation pour ce dépôt. Un dossier refusé n'est pas remboursé ; un complément demandé ne coûte rien.",
};

const uuid = (v, nom) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ErreurOutil("parametre_invalide", `« ${nom} » doit être un identifiant (UUID).`);
  return v;
};
const texte = (v, max) => (v === undefined || v === null ? undefined : String(v).slice(0, max));

/** Ce que coûtera l'envoi de ce dossier, d'après mes_credits (même règle que uman.registre_dossier_soumettre). */
export function coutEnvoi(d, credits) {
  if (d.paye_par) return { mode: "deja_paye", texte: "Déjà payé : un nouvel envoi après complément est gratuit." };
  const f = credits?.forfait;
  if (!d.collection_id && f && f.utilises < f.mensuel) {
    return { mode: "forfait", texte: `Compris dans le forfait du mois des artistes sous contrat (${f.utilises} sur ${f.mensuel} utilisés).` };
  }
  if (d.collection_id) return { mode: "collection", texte: "Un crédit de la collection (payé par l'institution)." };
  if ((credits?.solde ?? 0) >= 1) return { mode: "credit", texte: `Un crédit (solde actuel : ${credits.solde}).` };
  return { mode: "insuffisant", texte: `Aucun crédit disponible. Tarifs et achat : ${SITE}/registre/offres/` };
}

const resumeDossier = (d) => ({
  id: d.id, statut: d.statut, titre: d.titre, createurs: d.createurs, technique: d.technique,
  oeuvre_id: d.oeuvre_id ?? null, registre_id: d.registre_id ?? null, collection: d.collection ?? null,
  etapes: d.etapes ?? [], pieces: (d.pieces ?? []).map((p) => ({ chemin: p.chemin, type: p.type, legende: p.legende })),
  video: d.video ?? null, lien: d.lien ?? null, manques: d.manques ?? [],
  motif: d.motif ?? null, modifie_le: d.modifie_le, soumis_le: d.soumis_le ?? null,
});

async function dossier(db, id) {
  const d = (await db.rpc("mes_dossiers")).find((x) => x.id === id);
  if (!d) throw new ErreurOutil("dossier_introuvable", "Dossier introuvable sur ce compte.");
  return d;
}

/** Signature du fichier → extension acceptée par le registre (mêmes formats que src/fichiers-registre.js de U-MAN). */
export function formatFichier(o) {
  const ascii = (a, b) => String.fromCharCode(...o.slice(a, b));
  if (o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return "jpg";
  if (o[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(0, 5) === "%PDF-") return "pdf";
  if (o[0] === 0x1a && o[1] === 0x45 && o[2] === 0xdf && o[3] === 0xa3) return "webm";
  if (ascii(4, 8) === "ftyp") return ascii(8, 10) === "qt" ? "mov" : "mp4";
  return null;
}
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

async function lireSource(a, chercher) {
  if (a.contenu_base64) {
    let o;
    try { o = Uint8Array.from(atob(String(a.contenu_base64).replace(/\s/g, "")), (c) => c.charCodeAt(0)); }
    catch { throw new ErreurOutil("parametre_invalide", "« contenu_base64 » n'est pas du base64 valide."); }
    return o;
  }
  let u;
  try { u = new URL(String(a.url ?? "")); } catch { throw new ErreurOutil("parametre_invalide", "Donnez « url » (https) ou « contenu_base64 »."); }
  if (u.protocol !== "https:") throw new ErreurOutil("parametre_invalide", "L'adresse doit commencer par https://");
  const r = await chercher(u.href, { redirect: "follow" });
  if (!r.ok) throw new ErreurOutil("telechargement", `Téléchargement impossible (${r.status}).`);
  const annonce = Number(r.headers.get("content-length") ?? 0);
  if (annonce > TAILLE_MAX.video) throw new ErreurOutil("piece_trop_lourde", "Fichier trop lourd (90 Mo au plus pour une vidéo, 10 Mo pour une image).");
  return new Uint8Array(await r.arrayBuffer());
}

// ─── Définitions ────────────────────────────────────────────────────────────

const LECTURE = { readOnlyHint: true, openWorldHint: false };

export const OUTILS = [
  {
    name: "mes_credits",
    title: "Crédits d'indexation",
    description: "Solde de crédits d'indexation au registre U-MAN Art, forfait mensuel des artistes sous contrat (3 œuvres par mois, non cumulable), lots et dates d'expiration. Un dossier envoyé au contrôle coûte un crédit ou une œuvre du forfait.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: LECTURE,
    async faire(db) {
      const c = await db.rpc("mes_credits");
      return { ...c, achat: `${SITE}/registre/offres/` };
    },
  },
  {
    name: "mes_oeuvres",
    title: "Mes œuvres",
    description: "Œuvres de la page d'artiste du compte sur u-man.art, avec leur identifiant de fiche au registre si elles y sont déjà (registre_id). Une œuvre sans registre_id peut être référencée avec preparer_dossier(oeuvre_id).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: LECTURE,
    async faire(db) {
      return { oeuvres: await db.table("oeuvres?select=id,titre,slug,annee,technique,publiee,registre_id&order=ordre.asc,cree_le.desc") };
    },
  },
  {
    name: "mes_dossiers",
    title: "Mes dossiers de dépôt",
    description: "Dossiers de dépôt au registre du compte (brouillon, a_completer, soumis, publie, refuse), avec ce qu'il manque pour pouvoir les envoyer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: LECTURE,
    async faire(db) { return { dossiers: (await db.rpc("mes_dossiers")).map(resumeDossier) }; },
  },
  {
    name: "preparer_dossier",
    title: "Préparer un dossier",
    description: "Crée ou complète un brouillon de dépôt (gratuit : rien n'est envoyé ni payé). Sans dossier_id : nouveau brouillon, prérempli depuis l'œuvre si oeuvre_id est donné (ses images publiées deviennent des pièces). Avec dossier_id : seuls les champs fournis changent. Pour être envoyé, un dossier demande un titre, l'artiste, une description du processus de 80 caractères au moins, deux étapes et deux pièces (ou une pièce et une vidéo). Le registre documente un processus humain : décrivez le travail réel de l'artiste, sans rien inventer. Aucune IA générative n'est acceptée, même pour un usage secondaire.",
    inputSchema: {
      type: "object",
      properties: {
        dossier_id: { type: "string", format: "uuid", description: "Brouillon à compléter." },
        oeuvre_id: { type: "string", format: "uuid", description: "Œuvre de la page d'artiste (voir mes_oeuvres), pour un nouveau brouillon." },
        titre: { type: "string", maxLength: 120 },
        createurs: { type: "string", maxLength: 120, description: "Nom de l'artiste (ou des artistes)." },
        technique: { type: "string", maxLength: 200 },
        declaration: { type: "string", maxLength: 3000, description: "Description du processus de création, par l'artiste (80 caractères au moins)." },
        etapes: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 20, description: "Étapes de création, dans l'ordre (2 au moins). Remplace la liste existante." },
        video: { type: "string", description: "Lien vers une vidéo du processus (YouTube, Vimeo…)." },
        lien: { type: "string", description: "Lien vers l'œuvre (site, portfolio)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async faire(db, a) {
      let d;
      if (a.dossier_id) d = await dossier(db, uuid(a.dossier_id, "dossier_id"));
      else if (a.oeuvre_id) d = await db.rpc("registre_dossier_depuis_oeuvre", { p_oeuvre: uuid(a.oeuvre_id, "oeuvre_id") });
      const champs = ["titre", "createurs", "technique", "declaration", "video", "lien"];
      const p = Object.fromEntries(champs.map((c) => [c, d?.[c] ?? ""]));
      p.etapes = d?.etapes ?? [];
      p.usage_ia = "aucun";                      // aucune IA générative au registre (contrainte de la base)
      for (const c of champs) if (a[c] !== undefined) p[c] = texte(a[c], 3000);
      if (Array.isArray(a.etapes)) p.etapes = a.etapes.map((e) => texte(e, 300));
      const r = await db.rpc("registre_dossier_enregistrer", { p_id: d?.id ?? null, p });
      const final = await dossier(db, r.id);
      return { dossier: resumeDossier(final), page: `${SITE}/registre/deposer/` };
    },
  },
  {
    name: "ajouter_piece",
    title: "Ajouter une pièce",
    description: "Ajoute une pièce au brouillon : croquis, étape, calques, fichier source, photo d'atelier (JPEG, PNG, WebP ou PDF, 10 Mo au plus ; une vidéo MP4/WebM/MOV de 90 Mo au plus). Donnez une adresse https du fichier ou son contenu en base64. 8 pièces au plus plus une vidéo.",
    inputSchema: {
      type: "object",
      required: ["dossier_id"],
      properties: {
        dossier_id: { type: "string", format: "uuid" },
        url: { type: "string", description: "Adresse https du fichier." },
        contenu_base64: { type: "string", description: "Contenu du fichier en base64 (à la place de url)." },
        type: { type: "string", enum: TYPES_PIECE, description: "Nature de la pièce (ignorée pour une vidéo)." },
        legende: { type: "string", maxLength: 200 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async faire(db, a, ctx) {
      const d = await dossier(db, uuid(a.dossier_id, "dossier_id"));
      const octets = await lireSource(a, ctx.chercher);
      const ext = formatFichier(octets);
      if (!ext) throw new ErreurOutil("format", "Format refusé : JPEG, PNG, WebP, PDF, MP4, WebM ou MOV.");
      const video = ["mp4", "webm", "mov"].includes(ext);
      if (octets.length > (video ? TAILLE_MAX.video : TAILLE_MAX.image)) throw new ErreurOutil("piece_trop_lourde", video ? "Vidéo trop lourde : 90 Mo au plus." : "Fichier trop lourd : 10 Mo au plus.");

      const chemin = `${d.id}/${crypto.randomUUID()}.${ext}`;
      const r = await ctx.chercher(`${SITE}/fichiers-registre/${chemin}`, {
        method: "PUT", body: octets, headers: { "Content-Type": MIME[ext], Authorization: `Bearer ${ctx.jeton}` },
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new ErreurOutil(e?.erreur?.code ?? "envoi", e?.erreur?.message ?? `Envoi refusé (${r.status}).`);
      }
      const pieces = [...(d.pieces ?? []), { chemin, type: TYPES_PIECE.includes(a.type) ? a.type : "autre", legende: texte(a.legende, 200) ?? "" }];
      try {
        await db.rpc("registre_dossier_pieces", { p_dossier: d.id, p_pieces: pieces });
      } catch (e) {                               // pièce refusée par le dossier : on ne la laisse pas dans R2
        await ctx.chercher(`${SITE}/fichiers-registre/${chemin}`, { method: "DELETE", headers: { Authorization: `Bearer ${ctx.jeton}` } }).catch(() => {});
        throw e;
      }
      return { dossier: resumeDossier(await dossier(db, d.id)), piece: chemin };
    },
  },
  {
    name: "soumettre_dossier",
    title: "Envoyer au contrôle",
    description: "Envoie un dossier complet au contrôle de l'équipe U-MAN Art. COÛTE un crédit ou une œuvre du forfait (gratuit après une demande de complément). Appelez d'abord sans les deux confirmations : l'outil rend le coût, ce qui manque et les deux déclarations exactes. Montrez-les mot pour mot à l'artiste et ne rappelez avec declaration_honneur et renonciation_retractation à true QUE s'il les accepte explicitement dans la conversation. Ne cochez jamais à sa place.",
    inputSchema: {
      type: "object",
      required: ["dossier_id"],
      properties: {
        dossier_id: { type: "string", format: "uuid" },
        declaration_honneur: { type: "boolean", description: `true seulement si l'artiste accepte : « ${DECLARATIONS.honneur} »` },
        renonciation_retractation: { type: "boolean", description: `true seulement si l'artiste accepte : « ${DECLARATIONS.renonciation} »` },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async faire(db, a) {
      const d = await dossier(db, uuid(a.dossier_id, "dossier_id"));
      const cout = coutEnvoi(d, await db.rpc("mes_credits"));
      const apercu = { dossier: resumeDossier(d), cout, declarations: DECLARATIONS };
      if (!["brouillon", "a_completer"].includes(d.statut)) throw new ErreurOutil("dossier_non_modifiable", `Ce dossier est « ${d.statut} » : il n'y a rien à envoyer.`);
      if (d.manques?.length) return { ...apercu, envoye: false, message: `Il manque : ${d.manques.join(" ; ")}.` };
      if (cout.mode === "insuffisant") return { ...apercu, envoye: false, message: cout.texte };
      if (a.declaration_honneur !== true || a.renonciation_retractation !== true) {
        return { ...apercu, envoye: false, message: "Rien n'est envoyé. Montrez à l'artiste le coût et les deux déclarations, mot pour mot ; rappelez avec les deux confirmations à true seulement s'il les accepte." };
      }
      const r = await db.rpc("registre_dossier_soumettre", { p_dossier: d.id, p_accords: { honneur: true, renonciation: true } });
      return { envoye: true, dossier: resumeDossier({ ...d, ...r, manques: [] }), cout,
        message: "Dossier envoyé au contrôle de l'équipe. L'artiste est prévenu de la décision (publication, complément ou refus motivé)." };
    },
  },
  {
    name: "consulter_fiche",
    title: "Consulter une fiche",
    description: "Lit une fiche publique du registre U-MAN Art (« Processus humain documenté ») par son identifiant UM-XXXXX : œuvre, artiste, étapes, historique, horodatage. Une fiche n'est ni une certification ni une expertise.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", pattern: "^UM-[0-9A-Za-z]{5}$" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async faire(_db, a, ctx) {
      const id = String(a.id ?? "").trim().toUpperCase();
      if (!ID_FICHE.test(id)) throw new ErreurOutil("parametre_invalide", "Identifiant attendu : UM- suivi de 5 caractères.");
      const r = await ctx.chercher(`${SITE}/api/registre/${id}`);
      if (r.status === 404) throw new ErreurOutil("introuvable", `Aucune fiche ${id}.`);
      if (!r.ok) throw new ErreurOutil("registre", `Registre indisponible (${r.status}).`);
      return { fiche: await r.json(), page: `${SITE}/registre/${id}/` };
    },
  },
];
