# AGENTS.md

Consignes pour les agents de code qui travaillent sur ce dépôt. La documentation utilisateur est le [README.md](README.md) ; un résumé destiné aux LLM des utilisateurs est dans [llms.txt](llms.txt).

## Le projet

MorphineOrm (`morphine-orm` sur npm) : un petit ORM Node.js où l'on continue d'écrire du SQL. Les modèles sont des objets JavaScript, les conditions sont des clauses `WHERE` avec des `?`, les associations sont chargées par `LEFT JOIN` en une seule requête, et le schéma est synchronisé avec les modèles au démarrage.

Trois bases sont supportées, à égalité : MySQL / MariaDB (`mysql2`), PostgreSQL (`pg`) et SQLite (`sqlite3`). Toute fonctionnalité doit marcher sur les trois, ou documenter sa limite (ex. : SQLite ne peut pas modifier une colonne).

## Commandes

```sh
npm run lint           # ESLint
npm run format:check   # Prettier (npm run format pour corriger)
npm run test-sqlite    # tests sur SQLite, sans serveur : à lancer en premier
npm test               # tests sur MySQL / MariaDB (= npm run test-mysql)
npm run test-pg        # tests sur PostgreSQL
npm run bench          # banc d'essai MorphineOrm / Drizzle / Prisma (MySQL)
```

- Les tests MySQL et PostgreSQL lisent leur connexion dans `.env.local` (voir le README, section Tests). Si aucune base n'est disponible, dis-le au lieu de prétendre que les tests passent.
- Les tests **créent, vident et suppriment** les tables des modèles de `models/`, et le banc d'essai vide `Species2`, `Breeds2` et `Animals2` : jamais sur une base qui contient de vraies données.
- Avant de terminer une modification : `npm run lint`, `npm run format:check` et au moins `npm run test-sqlite` doivent passer.

## Architecture

| Fichier                    | Rôle                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.js`                 | point d'entrée : exporte `MorphineDb`, `Models`, `loadModels`                                                                                                              |
| `src/MorphineDb.js`        | connexion et pools par driver, `query()`, `transaction()` (via `AsyncLocalStorage`), migrations (`createTable`, `updateTable`, index, contraintes), chargement des modèles |
| `src/MorphineTable.js`     | un modèle : définition, `createEmpty()`, et méthodes qui créent un `MorphineTableExec`                                                                                     |
| `src/MorphineTableExec.js` | une requête en construction (API chaînable) : construction du SQL, conditions, jointures, hooks, validation, `exec()` et post-traitement des lignes                        |
| `models/`                  | modèles d'exemple (`Species` → `Breeds` → `Animals`) utilisés par les tests et le banc d'essai                                                                             |
| `test.js`                  | toute la suite de tests (`node:test`), lancée avec le type de base en argument                                                                                             |
| `bench/`                   | banc d'essai, avec ses propres dépendances (`bench/package.json`)                                                                                                          |

Les différences entre bases sont gérées par des branches sur `this.config.type` (`"mysql2"`, `"pg"`, `"sqlite3"`). PostgreSQL a sa propre migration (`_updateTablePg`, `_pgType`…).

## Conventions

- JavaScript CommonJS (`require` / `module.exports`), Node.js ≥ 20, pas de TypeScript ni d'étape de build.
- Prettier : 100 colonnes, 2 espaces, guillemets doubles, points-virgules, virgules finales. ESLint impose aussi les guillemets doubles et les fins de ligne Unix.
- **Commentaires du code en français.** Ils expliquent le pourquoi (cas limite, différence entre bases), pas le quoi.
- **README en anglais.** Toute modification du comportement public met à jour le README, et `llms.txt` si elle touche à ce qu'il résume.
- Messages de commit en français, courts, qui décrivent ce qui change (ex. : « Conditions objet : IS NULL, IN, opérateurs, $or / $and »).
- Dépendances d'exécution minimales (`cli-color`, `dayjs`, `validator`) : les drivers restent en `devDependencies`, l'utilisateur installe le sien. N'en ajoute pas sans raison forte.
- Une correction de bug s'accompagne d'un test dans `test.js` qui échouait avant.

## Garde-fous à ne pas casser

Ces comportements sont voulus et testés ; ne les affaiblis pas sans qu'on te le demande explicitement :

- Une chaîne qui n'est qu'un nombre (`"12"`, `"0xc"`, `"12e0"`) est lue comme une clé primaire, jamais comme du SQL.
- Les clés d'une condition objet doivent être des noms de colonnes (regex `SAFE_COLUMN`), sinon `E_INVALID_WHERE`. Un opérateur inconnu lève la même erreur. `undefined` ne correspond à aucune ligne.
- `update`, `updateone` et `destroy` refusent une condition vide. `updateone` refuse une condition qui touche plusieurs lignes (`E_UPDATEONE_MANY`).
- `create` et `update` n'écrivent que les attributs du modèle.
- Les valeurs des requêtes sont masquées dans les logs d'erreur, sauf avec `logValues` ou `debug`.
- SQL brut : une seule instruction par requête, instructions de session refusées (`E_SESSION_STATEMENT`), connexion remise à zéro avant de retourner au pool.
- Dans une transaction, une erreur SQL lève toujours une exception, quel que soit `catchError`.
- `migrate: "alter"` ne supprime jamais de table ou de colonne et ne modifie jamais les données ; `migrate: "recreate"` est refusé quand `NODE_ENV=production`.
