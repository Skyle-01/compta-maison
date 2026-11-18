# Revue de code - compta-maison

Date : 2026-11-18. Revue en lecture seule : aucun fichier de code modifié. Instantané daté : les quatre items de `backlog/` créés ensuite reprennent les constats 1 à 6 de la section Bugs (le 3, `reset_db`, est dans l'item d'import) et les décisions prises ; les constats mineurs n'ont pas d'item.

Légende de fiabilité : **observé (moi)** = reproduit ou lu directement par moi ; **observé (agent)** = reproduit ou constaté par un sous-agent de lecture ; **inféré** = déduit de la lecture du code, non reproduit.

## Résumé

- Base saine : 459 tests backend, 183 tests frontend, ruff, eslint et build Next passent. Aucun bug bloquant sur le chemin nominal.
- Un écart métier réel : les comptes d'épargne externes (`deposit_pattern`) comptent aussi les lignes des comptes importés, contrairement à CLAUDE.md.
- La reconstruction et l'import sont fragiles aux valeurs exotiques (`NaN`, `inf`, décimale `.`) : un fichier archivé puis rejeté peut faire échouer toute reconstruction suivante.
- Vitest est intermittent (19 suites en échec au premier lancement de cette revue, puis vert) : le check n'est pas fiable tel quel.
- Le reste est de la duplication (règles SQL, buckets d'épargne, boilerplate fetch) et quelques tests de bornes manquants.

## Vérifications lancées

| Check | Résultat |
|---|---|
| `pytest backend/tests` | OK, 459 passés, code 0 |
| `ruff check backend` | OK, code 0 |
| `ruff format --check backend` | OK, code 0 |
| `npm run lint --prefix frontend` | OK, code 0 |
| `npm run build --prefix frontend` (type-check inclus) | OK, code 0 |
| `npm test --prefix frontend` | **1er lancement : code 1, 19 suites sur 19 en échec** (`Cannot read properties of undefined (reading 'config')`, 0 test exécuté). Relancé deux fois (depuis `frontend/` puis depuis la racine) : code 0, 183 passés |

Le dépôt est resté propre (`git status` vide après les checks). Le flaky vitest est déjà suivi dans `backlog/tech/vitest-intermittent-config-error.md` ; je l'ai reproduit juste après `npm run lint`, ce qui confirme la piste de ce fichier. Non reproduit en boucle, cause non établie.

## Bugs

Aucun constat **bloquant**.

### Important

1. **Épargne externe : les lignes de n'importe quel compte sont comptées.** `backend/app/core/transfers.py:272-275` marque `kind='transfer'` toute ligne non manuelle dont le libellé contient le `deposit_pattern`, et `backend/app/core/categorize.py:589-594` additionne les mêmes lignes sans filtre de compte. CLAUDE.md dit « the checking-account rows ». Scénario : pattern `ENFANT`, une ligne du LIVRET importé « INTERETS ENFANT LIVRET » (crédit 0,20) devient un transfert (sort des revenus) et vient en déduction du dépôt ENFANT (l'agent a mesuré `epargne` 1,00 EUR au lieu de 1,20 EUR attendu). Un virement checking vers LIVRET dont le libellé contient le pattern est compté deux fois. Correction la plus simple : ajouter `account_id IN (SELECT code FROM accounts WHERE type='checking')` aux deux requêtes, avec un test. Fiabilité : observé (agent, script de reproduction) pour les intérêts ; lu directement par moi (les deux requêtes n'ont aucun filtre de compte) ; le cas du virement double est inféré.

2. **Valeurs non finies dans un relevé : 500 après archivage, puis reconstruction cassée.** `backend/app/core/parsing.py:40-53` accepte `NaN` et `inf` (`float()`), `to_cents` (appelé en `backend/app/db.py:400`) lève `ValueError`/`OverflowError`, seul `IntegrityError` est capturé (`db.py:431`). Dans `backend/app/api/imports.py:90` le fichier est archivé dans `inputs/` avant l'insertion : il y reste. `reset_db.py` relit tout `inputs/`. Même défaut pour `budget_target` = `inf` (`backend/scripts/import_csv.py:119-121`). Correction : rejeter les valeurs non finies avec une erreur de ligne en français (`math.isfinite`). Fiabilité : observé (moi) pour `_parse_number('NaN')`, `to_cents(nan)` et `to_cents(inf)` ; la chaîne archive-puis-reconstruction est lue dans le code.

3. **`reset_db` supprime la base avant de savoir si la reconstruction réussit.** `backend/scripts/reset_db.py:132-140` fait `unlink` puis charge comptes, relevés, taxonomie. Un `accounts.csv` invalide ou le cas 2 laissent sans base. Atténuation : le snapshot (`reset_db.py:97-106`) contient la config et les overrides, et les transactions viennent d'`inputs/`, donc c'est récupérable avec `--source backup` une fois la cause corrigée. Ce n'est pas une perte de données silencieuse mais le service est coupé. Correction : construire dans un fichier temporaire puis `os.replace` en cas de succès. Fiabilité : observé (moi, lecture de l'ordre `unlink` puis chargements) ; le scénario d'échec est inféré.

4. **Décimale `.` : `12,50` lu comme `1250.0`.** `backend/app/core/parsing.py:47` supprime toutes les virgules quand `decimal='.'`. Un profil mal déclaré sur un fichier à virgule décimale multiplie les montants par 100 sans erreur. Correction : n'accepter la virgule que comme séparateur de milliers (motif `^\d{1,3}(,\d{3})*(\.\d+)?$`), sinon erreur. Fiabilité : observé (moi). Probabilité faible (profil mal configuré), impact fort (montants faux silencieux).

5. **Écritures de recalcul non atomiques et base sans délai d'attente.** `backend/app/core/recompute.py:8-14` enchaîne trois `connect()` indépendants (périodes, virements, règles) après le commit de l'import ; un échec à l'étape 2 ou 3 laisse des lignes importées avec périodes/virements à moitié à jour. `backend/app/db.py:340` ouvre sqlite sans `timeout` ni WAL, et les routes `def` tournent dans un pool de threads : deux onglets (import + édition de règle) peuvent donner « database is locked » après 5 s. Correction : une seule connexion pour les trois étapes ; `timeout=30`. Fiabilité : inféré (pas reproduit), usage mono-utilisateur donc impact limité.

6. **Frontend : l'erreur n'est jamais effacée après une réussite.** `frontend/src/lib/useMonthDashboard.ts:23-28` : `setError` sur échec, jamais `setError(null)` sur succès. « Le mois », « Budget » et « Statistiques » gardent la bannière d'erreur après un redémarrage du backend suivi d'un changement de mois qui réussit. Même motif dans `frontend/src/app/transactions/page.tsx:41-44`. Correction : `setError(null)` dans le `.then`. Fiabilité : observé (moi, lecture du hook) pour `useMonthDashboard` ; transactions : observé (agent).

### Mineur

7. `frontend/src/components/FiltersProvider.tsx:67-71` : un échec de la liste des mois la remplace par `NO_MONTHS`, `effectiveMonth` renvoie `""` et Transactions / À classer listent tous les mois sans message. Pas de garde contre une réponse périmée. Inféré.
8. `backend/app/api/transactions.py:395-397` : le PATCH groupé écrit `note = patch.note` sans condition, donc omettre `note` l'efface (le PATCH simple utilise `model_fields_set`, `transactions.py:430`). L'UI envoie toujours `note`, donc invisible aujourd'hui. Observé (moi, lecture) ; à ranger au contrat documenté (`{ids, category_id, note}`).
9. `backend/app/api/transactions.py:305` (et `categories.py:20`) : `month` non validé injecté dans `Content-Disposition` ; un `"` casse l'en-tête, un caractère non latin-1 donnerait un 500. Correction : `Query(pattern=r"^\d{4}-\d{2}$")`. En-tête observé (agent), 500 inféré.
10. `backend/app/api/imports.py:80` : `file.file.read()` sans plafond de taille. Usage local, impact faible. Observé (moi, lecture).
11. `backend/app/core/recurrences.py:113-119` : avec deux paliers plus un dernier montant isolé (`[100,100,100,200,200,200,300]`) la série tombe dans `variable` puis `None` (flux disparu). CLAUDE.md écrit « one run, or two runs (a step), plus an optional last isolated amount » ce qui se lit comme autorisant ce cas ; le test `test_recurrences.py:186` fige l'autre comportement. À trancher : corriger la doc ou le code. Observé (agent, exécuté) ; lecture du code confirmée par moi.
12. `backend/app/core/rule_issues.py:105-121` : une règle dont toutes les opérations sont en conflit reçoit `unused` en plus de `conflict` (`rule_id` NULL), ce qui peut pousser à la supprimer. Inféré, aucun test de cette combinaison.
13. `backend/app/core/categorize.py:441-467` : `category_averages.build` ignore les flux posés directement sur un groupe (l'arbre les compte). Invariant « feuille seule » donc théorique. Inféré.
14. `backend/app/core/parsing.py:78` / `bank_profiles.py:100` : un profil avec `encoding = "utf-8"` et un fichier avec BOM échoue (« Colonne(s) manquante(s) »), `strip()` ne retire pas U+FEFF. Observé (agent).
15. `backend/app/core/recurrences.py:146,180` : `round()` et `median` en arrondi bancaire (30,5 vers 30, 31,5 vers 32). Écart d'un jour sur la date attendue. Inféré.
16. `backend/scripts/reset_db.py:174-175` : sans `accounts.csv` dans la source, retombée silencieuse sur l'exemple fictif `data/accounts.csv` ; les relevés sont ignorés (« aucun compte connu ») et la reconstruction « réussit » presque vide. Observé (agent).
17. `backend/app/api/data_dir.py:40-43` : le fichier pointeur est écrit avant `init_db` ; si `init_db` échoue, le dossier fautif est mémorisé. Inféré.
18. `backend/app/api/rules.py:41-48` : `_get_one` peut passer `None` à `_to_model` après une suppression concurrente (TypeError 500). Observé (agent), très faible probabilité.
19. Écritures de config en série (`config_export.py:199-216`) : si `overrides.csv` est ouvert dans Excel, les trois premiers fichiers sont déjà remplacés ; la sauvegarde préalable existe mais le message ne le dit pas. Inféré.
20. Frontend : `app/export/page.tsx:51,62` télécharge au lieu d'avertir si la fenêtre d'aperçu est bloquée ; `lib/api.ts:547` tronque sans avertir une feuille à plus de 1000 opérations ; `listAccounts` avale ses erreurs (`import/page.tsx:41`, `AccountSelect.tsx:30`, `useAccounts.ts:8`) ; `Nav.tsx:38-42` sans garde de réponse périmée. Tous inférés, impact faible.
21. Écritures POST sans authentification ni en-tête non simple (`/api/imports`, `/api/config/export`...) : une page tierce ouverte dans le même navigateur peut déclencher ces écritures (réponse illisible, effet réel). Le bind est bien 127.0.0.1 (`dev.ps1:25`, aucun `--host`). Inféré ; seulement si l'app tourne pendant qu'un navigateur visite des sites tiers.

Contrôle de cohérence : l'agent frontend n'a trouvé aucune contradiction entre `lib/api.ts` et `schemas.py` sur 5 payloads comparés (Transaction, Account, ImportResult, Recurrence, RuleOut).

Zones saines (lues ou testées, rien trouvé) : formule `_row_hash` (figée), `connect()` (commit/rollback/fermeture), déduplication à l'import, appariement des virements (arrondis, égalités, ambiguïtés), bornes des fenêtres, `recompute_budget_months`, `settings.load_start_date`, SQL par f-string (uniquement des `?` ou des clauses fixes), noms de fichiers archivés (`Path(...).name`), échappement HTML du rapport mobile (`esc` partout, aucun `dangerouslySetInnerHTML`), division par zéro dans `categorize.py` et `flowLayout.ts`, réconciliation `Revenus - Dépenses - Épargne = Reste`.

## Écarts CLAUDE.md

- **Tiret long (interdit en prose et dans le code, chaînes et commentaires)** : 46 occurrences dans 15 fichiers `.py/.ts/.tsx`, dont des textes d'interface (`CategoryPicker.tsx:25,118` le libellé « sans catégorie » encadré de tirets, `settings/page.tsx:514`, `import/page.tsx:202,228`, `transactions/page.tsx:153`, `api.ts:454,459`) et la plupart des commentaires de `db.py`, `transfers.py`, `categorize.py`. Observé (moi, grep). Remplacer par un tiret simple, une virgule ou un point ; `api.test.ts:81` asserte l'un de ces textes et devra suivre.
- **Apostrophe typographique U+2019** : 35 occurrences dans 12 fichiers. Le CLAUDE.md projet tolère les anciens fichiers, mais des messages d'API en contiennent (`api/imports.py:72`, `api/config.py`, `api/categories.py` x5). Observé (moi, grep). Remplacer au fil des modifications seulement.
- **DRY** : voir la section suivante (au moins 6 duplications à 2+ usages réels, contre la règle « un seul endroit par fait »).
- **Dérive de la doc** : `.claude/CLAUDE.md` titre sa section « Current State (2026-10-09) » alors que son contenu décrit des pages ajoutées en novembre ; l'arborescence « Architecture » ne cite pas `lib/mobileReport.ts`, `mobileReportStyle.ts`, `reportData.ts`, `reportRequest.ts`, `useChanges.ts`, `useMonthDashboard.ts` (ceux-ci sont décrits dans `rules/frontend-pages.md`). Observé (moi). Mineur.
- **Conformes** : pas d'identifiant opaque (BUG-xxx, D4...) trouvé dans le code ni les commentaires (grep) ; backlog tenu (items sans id) ; aucun secret en dur repéré ; dépendances épinglées. Je n'ai pas vérifié le retour à la ligne forcé de la prose.
- **Dépendances en retard** (info, mise à jour manuelle voulue) : par exemple `fastapi` 0.141.1 pour 0.163.2 disponible, `httpx2` 2.13.1 pour 2.16.2 (`pip list --outdated`).

## DRY / KISS / YAGNI

Duplications réelles (2 copies ou plus), chaque correction = une fonction ou constante partagée :

1. **Seuil de signe de l'épargne écrit 3 fois** : `categorize.py:499-503` (`category_averages`), `574-580` (`_savings_net_cents`), `613-619` (`_savings_by_month`) ; `_savings_by_month:620` reconstruit en plus un dict identique à `out`. Observé (agent), confirmé par ma lecture de 574-620.
2. **Jointure règle/libellé et prédicat « flux réel non classé » copiés** : `categorize.py:19-24,52-58`, `rule_issues.py:80-85`, `triage.py:321-333` (jointure `instr(...)` + compte) ; prédicat non classé en `categorize.py:70-73,153-156`, `triage.py:249-251,315`. Les 4 copies concordent aujourd'hui. Observé (agent).
3. **Génération des candidats de virement** écrite deux fois : `transfers.py:124-145` (`pair_legs`) et `200-218` (`transfer_candidates`) ; l'expression `CASE WHEN credit_cents > 0 THEN 'income' ELSE 'expense' END` deux fois (`transfers.py:254,377`). Observé (agent) ; la ligne 254 est lue par moi.
4. **Import des relevés** : boucle liste/infère/résout/parse/`rows_since` en double dans `core/inputs.py:186-203` et `245-259` ; bloc chemins/chargement-ou-sortie et boucles d'affichage copiés entre `reset_db.py:42-94` et `import_inputs.py:18-53`. Observé (agent).
5. **API** : le gestionnaire `OSError` vers 500 est copié dans `config.py:14-22` et `43-49` ; `_reject_unknown_account` (`recurrences.py:45-48` et `rules.py:51-56`) ; le 404 « introuvable » (`transactions.py:387-389` et `categories.py:235-238`) ; `",".join("?" * len(ids))` une dizaine de fois. Observé (agent) ; `transactions.py:385,387-389` lu par moi.
6. **Frontend** : garde « réponse périmée » (`let stale`) copiée 7 fois (`useMonthDashboard.ts`, `AveragesSection.tsx:176-190`, `SpendingBreakdown.tsx:40-50`, `StatementSection.tsx:19-30`, `app/page.tsx:183-197`, `rapport/page.tsx`, `recurrents/page.tsx:33-45`) ; minuterie du toast et Alt+Z de `a-classer/page.tsx:173-176,309` qui répètent `useChanges.ts:31-32,76-82` ; `Math.round(x * 100) / 100` répété dans `report.ts:126`, `averages.ts:16,68`, `budget.ts:36,51,72,79`, `categoryTree.ts:42`. Observé (agent), copies correctes pour l'instant.

Code mort et paramètres inutiles :
- `transfers.py:113` : `pair_legs(window_days=...)` n'est jamais passé par un appelant (constante `TRANSFER_WINDOW_DAYS` utilisée). Observé (agent).
- `parsing.py:200-202` : `parse_csv` n'est appelé que par des tests. Observé (agent).
- Exports de valeurs utilisés dans leur propre fichier seulement : `report.ts` `REPORT_TREND_MONTHS`, `api.ts` `leafFilters` et `UNREACHABLE` (vérifié par moi) ; quelques types dans le même cas (inoffensifs).

Complexité évitable (sans urgence) : `frontend/src/app/settings/page.tsx` (611 lignes, cinq sections indépendantes dans un fichier) ; `categorize.py` (620 lignes) mélange arbre, budgets, moyennes et épargne.

Pas de dépendance superflue repérée. Je ne propose aucune nouvelle abstraction hors les petites fonctions partagées ci-dessus, et seulement à partir de 2 usages réels, comme demandé.

## Tests

Bien couverts (d'après l'audit de la suite) : appariement et ambiguïtés des virements, modes manuels, conflits et règles par compte, nœuds d'épargne et dépôts externes, réconciliation des moyennes et mois partiels, scissions, récurrences, API comptes et dossier de données, aller-retour export de config, égalité des reconstructions.

Constats :

1. `test_config_export.py:93-98` (`test_leaves_other_config_files_alone`) : le seul `assert` est le statut 200. Un export qui écraserait `bank_profiles.toml` ou `settings.toml` passerait. Correction : comparer les octets avant et après. Observé (agent).
2. `test_api_transactions.py:85-95` : le test annonce que les règles reprennent la ligne mais ne vérifie que `category_manual` et `note`. Correction : vérifier `category_id` et `rule_id`. Observé (agent).
3. `test_transfers.py:59-65` : les jambes sont à 10 jours, la fenêtre de 3 jours n'est jamais testée à sa borne (3 jours apparié, 4 non). Observé (agent).
4. `test_periods.py:11-100` : le seuil d'ancre « jour >= 15 » n'est jamais testé à 14 et 15 (ancres seulement aux 2 et 28). Changer en `> 15` passerait. Observé (agent).
5. Refus d'un objectif sous `Déficit` (`api/categories.py:95`) : aucun test (« Déficit » absent de `test_api_categories.py`). Observé (agent).
6. `api/dashboard.py:90` : `savings_actual` n'est asserté nulle part (seul `savings_target` l'est). Observé (agent).
7. `test_recurrences.py:129-152` : seuils (80 %, 25-35 jours, 35 %, tolérance 2 % / 0,50 EUR) testés loin des bornes. Observé (agent).
8. `test_api_transactions.py:112` : `rule_id is not None` accepte n'importe quelle règle. Observé (agent).
9. Frontend : pas de test pour `useChanges.ts` (minuterie d'annulation 8 s, avertissement de conflit) ni pour `reportData.ts` ; les composants non testés sont acceptés par le propriétaire. Observé (agent).
10. Aucun test pour les constats 1 (épargne externe filtrée par type de compte), 2 (`NaN`/`inf`) et 4 (décimale `.`) de la section Bugs : à ajouter avec les corrections.
11. Pas de dépendance au temps réel (`today`/`now`) dans les tests backend ; isolation par `conftest.py` correcte. Observé (agent).
12. Le flaky vitest (voir plus haut) est un défaut de la suite elle-même : un échec « 0 test » est indiscernable d'une vraie panne sans relance.

## Optimisations

Aucune optimisation mesurée : je n'ai pas profilé, et je n'en propose donc pas de spéculative. Deux points évidents à la lecture, à faible priorité :
- `find_conflicts` (jointure règles x opérations) est recalculé à chaque appel de `uncategorized_groups`, `conflicted_operations` et à chaque frappe de `rule_preview` (`triage.py:255-262`). Seulement utile si la page « À classer » devient lente sur un gros historique. Inféré.
- `recompute_all` ouvre 3 connexions et re-parcourt les mêmes tables ; l'unifier (constat 5 de la section Bugs) est un gain de robustesse avant d'être un gain de temps.

## Top 5 des actions à faire en premier

1. **Restreindre l'épargne externe aux comptes courants** (`transfers.py:272-275`, `categorize.py:589-594`) et ajouter le test (LIVRET « INTERETS ENFANT » qui ne doit pas devenir un transfert). C'est le seul écart qui fausse des chiffres affichés.
2. **Durcir le parsing et la reconstruction** : rejeter `NaN`/`inf` (`parsing.py`, `import_csv.py`), corriger la décimale `.`, et ne supprimer la base dans `reset_db.py` qu'après une reconstruction réussie (fichier temporaire puis `os.replace`) ; un test par cas.
3. **Stabiliser vitest** : suivre la piste du backlog (échecs après `lint`/`tsc`), puis décider d'un contournement ; tant que ce n'est pas fait, ne pas se fier à un échec « 0 test ». Je n'ai pas trouvé la cause.
4. **Faire recalculer en une seule connexion** (`recompute_all`) et donner un `timeout` à `sqlite3.connect`, pour éviter les états intermédiaires et les « database is locked ».
5. **Combler les tests de bornes** (ancre 14/15, fenêtre 3/4 jours, seuils des récurrences, `savings_actual`, assertions faibles de `test_config_export.py` et `test_api_transactions.py`), et corriger l'erreur non effacée de `useMonthDashboard.ts`.

Aucune correction n'était appliquée à la rédaction de ce rapport ; les actions 1, 2, 4 et 5 sont devenues des items de `backlog/`, à implémenter dans une session dédiée ; l'action 3 (vitest) garde son item existant, hors de cette série.
