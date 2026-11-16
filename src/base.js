// Appels à la base de U-MAN Art (PostgREST, schéma « uman ») avec le jeton de l'artiste.
// Le MCP n'a aucun droit propre : chaque fonction vérifie elle-même le compte (auth.uid()), les crédits et l'état
// du dossier, exactement comme pour la page https://u-man.art/registre/deposer/.

export class ErreurOutil extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

// Messages des erreurs levées par les fonctions de la base (raise exception '<code>').
const MESSAGES = {
  connexion_requise: "Connexion expirée : reconnectez U-MAN Art dans votre assistant.",
  dossier_introuvable: "Dossier introuvable sur ce compte.",
  dossier_non_modifiable: "Ce dossier est déjà envoyé au contrôle : il ne se modifie plus (sauf si l'équipe demande un complément).",
  trop_de_brouillons: "20 brouillons au plus : envoyez ou supprimez-en avant d'en ouvrir un autre.",
  dossier_incomplet: "Le dossier est incomplet.",
  accords_requis: "Les deux déclarations de l'artiste sont obligatoires.",
  credits_insuffisants: "Crédit insuffisant pour envoyer ce dossier.",
  trop_de_pieces: "8 pièces au plus (plus une vidéo).",
  piece_invalide: "Pièce invalide : elle doit avoir été envoyée dans ce dossier.",
  piece_trop_lourde: "Image trop lourde : 10 Mo au plus.",
  une_video: "Une seule vidéo par dossier.",
  oeuvre_introuvable: "Œuvre introuvable sur ce compte.",
};

export function base(env, jeton, chercher = fetch) {
  const entetes = (profil) => ({
    apikey: env.SUPABASE_CLE_PUBLIQUE,
    Authorization: `Bearer ${jeton}`,
    "Content-Type": "application/json",
    "Accept-Profile": profil,
    "Content-Profile": profil,
  });

  async function lire(r) {
    const texte = await r.text();
    const corps = texte ? JSON.parse(texte) : null;
    if (r.ok) return corps;
    const code = corps?.message ?? `http_${r.status}`;
    if (r.status === 401) throw new ErreurOutil("connexion_requise", MESSAGES.connexion_requise);
    throw new ErreurOutil(code, MESSAGES[code] ?? "La base a refusé la demande.", corps?.details ?? undefined);
  }

  return {
    rpc: async (nom, args = {}) => lire(await chercher(`${env.SUPABASE_URL}/rest/v1/rpc/${nom}`, {
      method: "POST", headers: entetes("uman"), body: JSON.stringify(args),
    })),
    table: async (chemin) => lire(await chercher(`${env.SUPABASE_URL}/rest/v1/${chemin}`, { headers: entetes("uman") })),
  };
}
