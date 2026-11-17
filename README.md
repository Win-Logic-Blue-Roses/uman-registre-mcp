# MCP du registre U-MAN Art

Serveur [MCP](https://modelcontextprotocol.io) distant qui permet à un artiste d'indexer ses œuvres au registre
**« Processus humain documenté »** de [U-MAN Art](https://u-man.art/registre/) depuis son assistant IA (Claude,
ChatGPT, Cursor…), avec son propre compte et ses propres crédits.

Adresse : **`https://mcp.u-man.art/mcp`**

> Le registre documente le processus de création d'une œuvre faite par un humain. Une fiche n'est ni une
> certification ni une expertise. Chaque dossier est contrôlé par l'équipe de U-MAN Art avant publication.
> U-MAN Art appartient au groupe Win-Logic.

## Se connecter

1. Dans votre assistant, ajoutez un connecteur MCP distant avec l'adresse `https://mcp.u-man.art/mcp`
   (Claude : Paramètres, Connecteurs, « Ajouter un connecteur personnalisé »).
2. Une page de u-man.art s'ouvre : connectez-vous comme d'habitude (code par e-mail ou Google), puis cliquez
   sur **Autoriser**.
3. C'est tout. Vous retirez l'accès quand vous voulez depuis votre assistant.

Il faut un compte U-MAN Art. Chaque compte documente **une œuvre par mois gratuitement** (non cumulable) ; au-delà, l'envoi d'un dossier au contrôle utilise **un crédit**, ou une œuvre du forfait mensuel
des artistes sous contrat (3 par mois). Tarifs : <https://u-man.art/registre/offres/>.

## Outils

| Outil | Rôle | Coût |
|---|---|---|
| `mes_credits` | solde, œuvre offerte ou forfait du mois, lots et expiration | gratuit |
| `mes_oeuvres` | œuvres de votre page d'artiste, avec leur fiche au registre | gratuit |
| `mes_dossiers` | dossiers de dépôt et ce qu'il leur manque | gratuit |
| `preparer_dossier` | crée ou complète un brouillon (depuis une œuvre ou de zéro) | gratuit |
| `ajouter_piece` | ajoute un croquis, une étape, des calques, une vidéo… (adresse https ou base64) | gratuit |
| `soumettre_dossier` | envoie au contrôle de l'équipe | œuvre gratuite du mois, sinon **1 crédit** |
| `consulter_fiche` | lit une fiche publique `UM-XXXXX` | gratuit |

`soumettre_dossier` n'envoie rien tant que l'artiste n'a pas accepté, dans la conversation, les deux déclarations
de la page de dépôt (déclaration sur l'honneur, renonciation au droit de rétractation pour ce dépôt). Appelé sans
elles, il rend le coût, ce qui manque et le texte exact à montrer.

Aucune IA générative n'est acceptée au registre, même pour un usage secondaire.

## Fonctionnement et sécurité

- **OAuth 2.1** selon la [spécification d'autorisation MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) :
  ce serveur publie ses métadonnées de ressource protégée (RFC 9728) sous
  `/.well-known/oauth-protected-resource/mcp` ; le serveur d'autorisation est Supabase Auth, celui des comptes
  U-MAN Art (enregistrement dynamique des clients, PKCE). La page d'autorisation est sur u-man.art.
- Le serveur **n'a aucun secret ni aucun droit propre** : il vérifie le jeton (ES256, JWKS du projet, émetteur,
  expiration, `client_id`), puis appelle les fonctions de la base avec le jeton de l'artiste. Crédits, droits et
  état des dossiers sont contrôlés par la base, exactement comme sur la page de dépôt.
- **Côté base, un jeton OAuth n'ouvre que les appels de ce MCP et du [MCP d'ANT-i](https://github.com/Win-Logic-Blue-Roses/anti-mcp)** :
  achats, paiements, retraits, coordonnées bancaires, contrats, documents et console restent fermés à tout assistant.
- Transport « Streamable HTTP », sans état (réponses JSON). 60 appels par minute et par compte.
- Suivi : les journaux notent le compte, l'application cliente et l'outil appelé, jamais le contenu des dossiers.

## Développer

```sh
npm test           # tests (node:test, sans réseau)
npm run dev        # serveur local (Wrangler)
npm run deploy     # tests puis déploiement (Worker « uman-registre-mcp », compte du groupe)
```

Aucune dépendance d'exécution. Essai avec l'inspecteur : `npx @modelcontextprotocol/inspector`, adresse
`https://mcp.u-man.art/mcp`.

---

## English

Remote MCP server for the U-MAN Art **"Documented human process"** registry. Artists connect their AI assistant to
`https://mcp.u-man.art/mcp`, sign in with their U-MAN Art account (OAuth 2.1, dynamic client registration) and can
prepare deposit files, upload process pieces and submit them for review. Submitting uses one credit (or one artwork of
the monthly allowance for artists under contract) and always requires the artist's explicit agreement to the two
declarations. No generative AI is accepted. A registry entry documents a process; it is not a certification.

Licence : MIT, © 2026 WIN-LOGIC BLUE ROSES SAS.
