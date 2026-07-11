# Toll Optimizer

## Conventions front (Inertia)

- **TypeScript strictement typé** dans `inertia/` : pas de `any` (implicite ou explicite), pas de cast paresseux (`as any`). Typer les réponses d'API, les props/emits des composants Vue et les événements DOM (ex. `$event.target as HTMLInputElement` plutôt que `$event.target.value` non typé). Les littéraux GeoJSON utilisent les types littéraux attendus (`'LineString'`, `'Point'`…). Vérifier avec `npx vue-tsc --noEmit -p tsconfig.inertia.json`.
- **Styles en LESS** : la feuille globale est `inertia/css/app.less` (importée par `inertia/app.ts`), les blocs `<style>` des composants Vue sont `scoped lang="less"`. Imbriquer les sélecteurs selon la hiérarchie du DOM ; utiliser la concaténation `&-suffixe` pour les classes dérivées (`.toll-item` → `&-kept`) afin de ne pas changer la spécificité.

## Commandes Node : toujours via Docker Compose

Node n'est pas utilisé directement sur la machine hôte. Toute commande Node (`node`, `npm`, `npx`, `ace`, etc.) doit être lancée via le service `node` du `docker-compose.yml` :

```bash
docker compose run --rm node <commande>
```

Exemples :

```bash
docker compose run --rm node npm install
docker compose run --rm node npx vue-tsc --noEmit -p tsconfig.inertia.json
docker compose run --rm node node ace migration:run
```

Pour le serveur de dev (port 3333 exposé) :

```bash
docker compose run --rm --service-ports node npm run dev
```
