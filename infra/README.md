# RoomHop — Infrastructure AWS CDK

Ce dossier décrit une architecture AWS prête à être synthétisée et déployée. Aucun déploiement AWS n'est nécessaire pour valider le projet localement, et aucun déploiement n'a été exécuté pendant les corrections.

## Contraintes conservées

- RDS MySQL reste volontairement en **Single-AZ** (`multiAz: false`).
- Le VPC utilise **deux subnets privés isolés dans deux AZ**.
- Search, Reservation et Metabase démarrent avec **une seule tâche** (`desiredCount: 1`). Les services applicatifs peuvent ensuite évoluer entre 1 et 4 tâches par autoscaling.
- Aucun NAT Gateway n'est créé; les workloads privés accèdent aux services AWS au moyen de VPC endpoints.

Ces invariants sont protégés par les tests de `infra/test/architecture.test.ts`.

## Architecture définie

<img width="2330" height="1881" alt="RoomHop_AWS architecture diagram drawio" src="https://github.com/user-attachments/assets/41378aa2-cd53-4283-ad74-1757a373e14e" />

```text
CloudFront + WAF
  ├─ S3 React SPA
  ├─ S3 hotel images (/images/*)
  └─ CloudFront VPC Origin (/v1/*, /analytics/*)
       +-- internal ALB (port 80; also routes /analytics/* to Metabase)
            ├─ Search ECS/Fargate ──> OpenSearch
            │    ├─ fallback RDS MySQL
            │    └─ ADOT ──> X-Ray VPC endpoint
            └─ Reservation ECS/Fargate ──> RDS MySQL
                         ├─ ADOT ──> X-Ray VPC endpoint
                         ├─ Cognito partner groups/status
                         └─ EventBridge
                              ├─ SQS notifications ──> Lambda ──> SES
                              └─ SQS analytics ──> Lambda ──> S3

RDS MySQL ── DMS full-load + CDC ──> OpenSearch
S3 analytics ──actual data──> Athena ──> Metabase ECS/Fargate
      └─> Glue Crawler (hourly) ──> Glue Catalog ──schema/partitions──> Athena
GitHub ──> CodeConnections + CodePipeline + CodeBuild
```

## Stacks

| Stack | Responsabilité |
|---|---|
| `RoomHop-Network` | VPC, 2 subnets isolés, VPC endpoints et security groups |
| `RoomHop-Database` | RDS MySQL Single-AZ, secret et migration/seed idempotent |
| `RoomHop-OpenSearch` | Domaine OpenSearch privé |
| `RoomHop-Auth` | Cognito, client SPA et groupes Guest/Partner/SuperAdmin |
| `RoomHop-Events` | EventBridge, archive, SQS/DLQ, notifications SES et ingestion analytics |
| `RoomHop-Compute` | Search et Reservation sur ECS/Fargate, ALB interne, ECR, OpenTelemetry/ADOT vers X-Ray |
| `RoomHop-Frontend` | Buckets privés, CloudFront, routage SPA/API/images et WAF |
| `RoomHop-Analytics` | Base/table Glue existantes, crawler horaire via Scheduler, Athena et bucket de résultats |
| `RoomHop-Metabase` | Metabase privé, DB dédiée et accès à /analytics/ via la distribution CloudFront principale |
| `RoomHop-DMS` | Réplication full-load + CDC de MySQL vers OpenSearch |
| `RoomHop-Observability` | CloudTrail et IAM Access Analyzer |
| `RoomHop-Pipeline` | GitHub, validation, builds, déploiements ECS/S3 et invalidation CloudFront |

## Validation locale, sans déploiement

Prérequis: Node.js 22+, npm et Docker pour construire les assets conteneurisés pendant `cdk synth`.

```powershell
cd infra
npm ci
npm run build
npm test
npm run synth
```

`cdk synth` génère uniquement les templates CloudFormation sous `cdk.out`; il ne crée aucune ressource AWS.

## Déploiement

Pour l'installation existante, suivre le [guide de migration VPC Origin par étapes](../docs/cloudfront-vpc-origin-migration.md). Ne pas lancer directement `deploy --all`: supprimer l'ancienne stack API après la migration de ses consommateurs. Les commandes ci-dessous concernent uniquement une nouvelle installation; fournir aussi le paramètre `RoomHop-Network:CloudFrontOriginFacingPrefixListId` décrit dans le guide.

Cette section est seulement une référence pour plus tard. Vérifier d'abord l'identité AWS et bootstrapper CDK dans `us-east-1`.

```powershell
cd infra
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1
npx cdk deploy --all --parameters RoomHop-Events:SesSenderEmail=sender@example.com --parameters RoomHop-Pipeline:GitHubOwner=YOUR_GITHUB_OWNER
```

Points à finaliser une fois l'infrastructure créée:

1. Vérifier l'adresse `SesSenderEmail` dans SES. Tant que le compte SES est dans la sandbox, vérifier aussi chaque destinataire de test.
2. Ouvrir CodeConnections et autoriser une fois la connexion GitHub créée par `RoomHop-Pipeline`.
3. Charger les fichiers d'images dans le bucket indiqué par l'output `ImagesBucketName`.
4. Ouvrir l'output `MetabaseUrl`, terminer le premier compte administrateur, puis définir cette URL comme Site URL.
5. Ajouter Athena dans Metabase avec la base Glue et le workgroup `roomhop-analytics`; laisser les clés AWS vides afin d'utiliser le rôle IAM de la tâche.

Pour le crawler horaire, suivre le [guide analytics](../docs/analytics-crawler.md): il réutilise `roomhop_analytics.reservations`, remplace la projection par les partitions cataloguées et nécessite un premier crawl réussi, puis une synchronisation du schéma dans Metabase. Le guide contient les permissions, coûts et commandes ciblées pour un déploiement ultérieur.

Le premier déploiement des services ne dépend pas d'images déjà présentes dans ECR: les task definitions utilisent des Docker assets CDK. Le pipeline pousse ensuite les versions GitHub dans les repositories ECR et met les trois services ECS à jour.

## Distributed tracing

Search et Reservation utilisent l'API OpenTelemetry et envoient leurs spans en OTLP/HTTP au collector ADOT présent dans la même tâche Fargate. Le collector exporte uniquement les traces vers AWS X-Ray par HTTPS via le VPC endpoint X-Ray privé; aucun NAT Gateway n'est requis. Le collector est `essential: false` et l'application ne dépend pas de son health check: une panne de télémétrie ne rend donc pas la tâche applicative indisponible.

Le sampling est `parentbased_traceidratio`. Son taux est choisi dans `CONFIG.observability.traceSamplingRates` à partir de `CONFIG.environment`: 100 % en développement/test, 50 % en recette et 10 % en production. `TRACING_ENABLED=false` désactive l'initialisation dans l'application.

La configuration, les arbres de spans attendus, les règles de protection des données et la procédure de validation AWS se trouvent dans [../docs/distributed-tracing.md](../docs/distributed-tracing.md).

## Flux partenaire et e-mail

La soumission `POST /v1/admin/partners/applications`:

1. utilise exclusivement le JWT Cognito validé par le service Reservation (signature, issuer, audience, expiration et token_use);
2. enregistre ou met à jour la demande dans MySQL;
3. place l'utilisateur dans `HotelPartnerPending`;
4. publie `PartnerApplicationSubmitted` dans EventBridge;
5. distribue l'événement via SQS à la Lambda de notification;
6. envoie l'accusé de réception à `corporateEmail` via SES.

Les réservations sont elles aussi liées au `sub` Cognito côté serveur: les identifiants de client (`guest_id` ou e-mail passés en query string) ne servent jamais à autoriser une lecture ou une annulation.

Les échecs SQS sont renvoyés individuellement pour être retentés puis placés en DLQ. Les événements sont également archivés dans EventBridge pour faciliter un replay contrôlé.

## Diagnostic e-mail

Si l'e-mail n'arrive pas après un futur déploiement:

- confirmer les identités SES et la région `us-east-1`;
- inspecter `/roomhop/lambda/notification-handler`;
- contrôler `roomhop-notification-dlq`;
- vérifier que l'événement `PartnerApplicationSubmitted` se trouve dans l'archive EventBridge;
- confirmer que `SENDER_EMAIL` correspond au paramètre vérifié.

## Recherche et réplication

DMS réplique les tables `hotel`, `room_type`, `room_type_rate`, `room_type_inventory` et `hotel_images` dans des index séparés. Le service Search assemble ces documents à la lecture et utilise MySQL comme fallback si OpenSearch n'est pas disponible. Le paramètre RDS active le row-based binlog requis pour le CDC.
