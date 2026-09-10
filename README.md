# RoomHop — Hotel Management System

RoomHop est une plateforme de recherche, réservation et gestion hôtelière. Le dépôt conserve un environnement local Docker et une architecture AWS complète décrite en CDK TypeScript.

L'application AWS est déjà déployée. La migration VPC Origin est préparée localement, sans déploiement; suivre le [guide de migration](docs/cloudfront-vpc-origin-migration.md) après revue.

## Fonctionnalités

- recherche d'hôtels par destination, dates, voyageurs, prix et équipements;
- disponibilité et tarification par nuit, avec OpenSearch et fallback MySQL;
- création, consultation et annulation de réservations;
- authentification Cognito et autorisation par groupes;
- demande d'accès Hotel Property Owner, revue administrateur et gestion des propriétés;
- confirmations de réservation et de demande partenaire par EventBridge, SQS, Lambda et SES;
- événements analytics dans S3, catalogués par Glue et interrogés avec Athena/Metabase;
- frontend React responsive derrière CloudFront et WAF;
- pipeline GitHub/CodePipeline pour les tests, images conteneur et assets frontend.
- traces applicatives OpenTelemetry exportées vers AWS X-Ray par un collector ADOT non essentiel dans chaque tâche Search et Reservation.

## Architecture AWS

<img width="2330" height="1881" alt="RoomHop_AWS architecture diagram drawio" src="https://github.com/user-attachments/assets/2a3ffef9-910b-460b-b577-942529e51816" />

```text
Browser --> CloudFront + WAF --> OAC --> private S3 SPA / images
                   |
                   +--> VPC Origin --> internal ALB :80
                                        |-- /v1/search* --> Search ECS
                                        |-- /v1/reservations*, /v1/admin* --> Reservation ECS (Cognito JWT)
                                        +-- /analytics/* --> Metabase ECS (session login)

RDS Single-AZ ── DMS full-load + CDC ──> OpenSearch
Reservation ── EventBridge ──> SQS ──> Lambda ──> SES / S3
S3 analytics ──actual data──> Athena ──> Metabase ECS
      └─> Glue Crawler (hourly) ──> Glue Catalog ──schema/partitions──> Athena
GitHub ──> CodeConnections + CodePipeline + CodeBuild
```

Contraintes intentionnelles:

- RDS MySQL est Single-AZ;
- le VPC couvre deux AZ avec deux subnets privés isolés;
- les services ECS utilisent `desiredCount: 1` au démarrage;
- aucun NAT Gateway n'est créé.

La documentation détaillée se trouve dans [infra/README.md](infra/README.md). Le fonctionnement et le diagnostic des traces sont décrits dans [docs/distributed-tracing.md](docs/distributed-tracing.md).

## Organisation

| Dossier | Rôle |
|---|---|
| `hotel-ui/` | SPA React/Vite |
| `hotel-api/` | API Express locale |
| `services/search-service/` | service Search AWS |
| `services/reservation-service/` | réservations et administration partenaire AWS |
| `services/lambda/notification-handler/` | e-mails de réservation et partenaire |
| `services/lambda/analytics-handler/` | ingestion analytics S3 |
| `services/lambda/db-migration/` | schéma, seed initial et migrations incrémentales |
| `services/lambda/metabase-db-init/` | base applicative dédiée à Metabase |
| `infra/` | 13 stacks AWS CDK |
| `database/` | migrations et données initiales locales |

## Développement local

Prérequis: Node.js 22+, npm et Docker Desktop.

```powershell
docker compose up -d
Get-Content database/migration_v2.sql -Raw | docker exec -i hotel-mysql mysql -u root -prootpassword hotel_db
Get-Content database/seed_v2.sql -Raw | docker exec -i hotel-mysql mysql -u root -prootpassword hotel_db
```

Puis lancer les composants requis dans des terminaux séparés:

```powershell
cd hotel-api
npm install
node src/app.js
```

```powershell
cd hotel-ui
npm install
npm run dev
```

Pour consommer les événements Kafka locaux (les e-mails sont simulés dans les logs en développement):

```powershell
cd notification-service
npm install
npm start
```

L'application locale est disponible sur `http://localhost:5173`.

## Validation

```powershell
cd hotel-api
npm test

cd ../hotel-ui
npm run lint
npm test
npm run build

cd ../infra
npm run build
npm test
npm run synth
```

Les services AWS et Lambdas possèdent aussi leurs propres suites `npm test`. Voir [infra/README.md](infra/README.md) pour le détail, les paramètres de déploiement éventuel et les prérequis SES/GitHub/Metabase.

Le [guide du crawler analytics](docs/analytics-crawler.md) décrit le catalogue existant, le crawl horaire, les permissions Metabase, les requêtes de validation et le premier crawl nécessaire après un éventuel déploiement.
