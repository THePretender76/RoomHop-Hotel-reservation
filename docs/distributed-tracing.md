# Distributed tracing RoomHop

## Architecture

Chaque tâche Fargate Search ou Reservation contient un seul collector de télémétrie, le collector AWS Distro for OpenTelemetry (ADOT). Le daemon X-Ray historique n'est plus utilisé.

```text
Application Node.js
  -> OTLP/HTTP 127.0.0.1:4318
  -> ADOT Collector non essentiel
  -> HTTPS 443 / Private DNS
  -> Interface VPC Endpoint X-Ray
  -> AWS X-Ray
```

Le receiver OTLP n'est pas exposé hors de l'interface réseau partagée par les conteneurs de la tâche. Le security group dédié au VPC endpoint X-Ray n'accepte que TCP/443 depuis le security group ECS. La policy du endpoint et les task roles autorisent seulement `xray:PutTraceSegments`. La télémétrie interne X-Ray du collector est explicitement désactivée, donc `PutTelemetryRecords` et les actions de sampling centralisé ne sont pas nécessaires.

Le collector est `essential: false`, sans dépendance ECS depuis le conteneur applicatif. L'exporteur OpenTelemetry utilise une file bornée et des délais courts. Si le collector est arrêté ou inaccessible, les requêtes continuent; seules des traces peuvent être perdues.

## Instrumentation

L'instrumentation est volontairement manuelle et limitée aux frontières opérationnelles. Aucune auto-instrumentation SQL ou HTTP n'est activée, afin d'éviter des spans bruyants et la capture accidentelle de requêtes, paramètres, URLs ou en-têtes sensibles.

Flux Search nominal:

```text
search.request
└── opensearch.search
```

Flux Search avec fallback:

```text
search.request
├── opensearch.search (ERROR)
└── mysql.fallback
```

Flux de création de réservation:

```text
reservation.create
├── auth.verify
├── mysql.transaction
│   ├── mysql.inventoryLock
│   ├── mysql.createReservation
│   ├── mysql.updateInventory
│   └── mysql.commit
└── eventbridge.putEvents
```

Le rollback produit `mysql.rollback` uniquement sur le chemin d'erreur. L'annulation reprend les mêmes frontières importantes. Les opérations administrateur partenaire ne créent des spans que pour les mutations principales. `PutEvents` reçoit aussi un `TraceHeader` X-Ray calculé depuis le span actif, sans inclure le contenu métier de l'événement; les futurs consommateurs instrumentés pourront ainsi reprendre ce contexte.

Les logs Winston récupèrent automatiquement `traceId` et `spanId` depuis le contexte actif. Une recherche CloudWatch Logs sur le `traceId` permet donc de passer d'une trace aux logs applicatifs associés.

## Sampling

La stratégie applicative est `ParentBasedSampler(TraceIdRatioBasedSampler)`. Elle ne dépend pas des règles de sampling X-Ray et ne nécessite aucun appel de contrôle supplémentaire depuis le VPC.

| Environnement | Taux par défaut |
|---|---:|
| développement / test | 1.0 |
| recette / staging | 0.5 |
| production | 0.1 |

La source d'infrastructure est `CONFIG.observability.traceSamplingRates` dans `infra/lib/config.ts`. La valeur sélectionnée est injectée dans `OTEL_TRACES_SAMPLER_ARG`. Le taux doit rester compris entre 0 et 1; une valeur invalide revient au taux par défaut de l'environnement. `TRACING_ENABLED=false` coupe complètement le tracing.

Le head sampling décide au début de la requête. Il ne peut donc pas conserver rétrospectivement 100 % des erreurs. Pour conserver toutes les erreurs sans complexifier l'architecture, utiliser temporairement un taux supérieur pendant une investigation. Un tail-sampling centralisé pourrait être étudié plus tard seulement si ce besoin devient permanent.

## Protection des données

Les annotations X-Ray utilisent une allowlist fermée:

- `service`
- `operation`
- `fallback`
- `result_source`
- `auth_valid`
- `error_type`
- `event_type`

Ne jamais ajouter aux spans ou aux annotations: JWT, claims Cognito identifiants, e-mail, nom, téléphone, date de naissance, identifiant utilisateur, mot de passe, token, secret, chaîne de connexion, paramètres ou texte SQL, contenu d'événement ou termes de recherche. Les exceptions ne sont pas enregistrées dans les spans; seul un type d'erreur normalisé est conservé. Les limites de nombre et de longueur des attributs sont également bornées dans le SDK.

## Limite de propagation en entrée

L'entrée publique utilise API Gateway HTTP API. Contrairement à API Gateway REST API, HTTP API ne fournit pas de tracing X-Ray actif. L'ALB peut ajouter ou transmettre `X-Amzn-Trace-Id`, mais ne produit pas son propre segment X-Ray. De plus, cet en-tête arrive initialement d'un appelant public et ne peut pas être supprimé par le parameter mapping HTTP API car les en-têtes `x-amzn-*` sont réservés.

Les services commencent donc volontairement une racine de confiance locale et n'extraient aucun trace context entrant contrôlé par le client. La durée visible commence au service ECS; API Gateway et l'ALB n'apparaissent pas comme des segments corrélés dans la même trace. Leurs métriques restent la source pour mesurer la latence en amont. Les appels sortants importants sont représentés par des spans manuels enfants.

## Validation après déploiement

1. Vérifier le diff avant déploiement: `cd infra`, puis `npx cdk diff RoomHop-Network RoomHop-Compute RoomHop-Pipeline`.
2. Déployer les stacks concernées selon la procédure normale du projet. Ne pas créer de NAT Gateway.
3. Dans ECS, ouvrir le cluster `roomhop-cluster`, puis les services `roomhop-search` et `roomhop-reservation`. Chaque tâche doit être `RUNNING`; le conteneur applicatif doit être `HEALTHY`. Le collector peut être healthy ou, en cas de panne, arrêté sans faire arrêter le conteneur applicatif.
4. Dans CloudWatch Logs, ouvrir `/ecs/roomhop/search` et `/ecs/roomhop/reservation`. Vérifier les streams `search-adot` et `reservation-adot`: la configuration doit démarrer sans erreur `AccessDenied`, `connection refused`, DNS ou timeout X-Ray.
5. Exécuter une recherche valide qui utilise OpenSearch, puis une recherche de test pendant une indisponibilité OpenSearch contrôlée uniquement si un exercice de panne est prévu. Ne pas provoquer cette panne en production.
6. Exécuter une réservation de test avec un compte et des données synthétiques, puis éventuellement une annulation.
7. Attendre au moins 10 secondes pour le batch d'export, puis ouvrir la console AWS dans `us-east-1`: CloudWatch > X-Ray traces > Traces, ou X-Ray > Traces selon la navigation affichée.
8. Filtrer sur les services `roomhop-search` et `roomhop-reservation`, sur les cinq dernières minutes. Avec 10 % de sampling, répéter plusieurs requêtes si nécessaire ou relever temporairement le taux en recette.
9. Ouvrir une trace Search et vérifier `search.request`, `opensearch.search`, puis `mysql.fallback` uniquement pour le chemin de repli. Contrôler les durées et le statut ERROR du span OpenSearch en échec.
10. Ouvrir une trace Reservation et vérifier `reservation.create`, `auth.verify`, les enfants de `mysql.transaction`, puis `eventbridge.putEvents`. Sur une erreur transactionnelle, vérifier `mysql.rollback`.
11. Copier le trace ID. Dans CloudWatch Logs Insights, sélectionner le log group applicatif correspondant et exécuter:

    ```text
    fields @timestamp, level, service, traceId, spanId, message, errorType
    | filter traceId = "TRACE_ID_COPIÉ"
    | sort @timestamp asc
    ```

12. Inspecter les attributs de plusieurs spans et confirmer l'absence de JWT, e-mail, nom, téléphone, secret, SQL, paramètres SQL, contenu d'événement et termes de recherche.

## Si aucune trace ne remonte

Vérifier dans cet ordre:

1. La task definition contient `TRACING_ENABLED=true`, `OTEL_TRACES_SAMPLER_ARG` supérieur à zéro et l'endpoint `http://127.0.0.1:4318/v1/traces`.
2. Le collector ADOT est présent, son health check `/healthcheck` fonctionne et ses logs ne montrent pas d'erreur de parsing de `config.yaml`.
3. Le task role contient `xray:PutTraceSegments`; cette permission n'appartient pas à l'execution role.
4. Le VPC endpoint résout `xray.us-east-1.amazonaws.com` avec Private DNS, son état est `Available`, sa policy autorise `xray:PutTraceSegments` et son security group reçoit TCP/443 depuis le security group ECS.
5. Les logs collector ne contiennent ni `AccessDeniedException`, ni erreur DNS/TLS, ni timeout. En cas de `AccessDenied`, contrôler à la fois le task role et la policy du endpoint.
6. Le taux de sampling n'est pas nul. En production à 0.1, générer au moins quelques dizaines de requêtes synthétiques ou augmenter temporairement le taux en recette.
7. La console est ouverte dans la région `us-east-1` et la fenêtre temporelle contient les appels effectués.
8. Les métriques ECS `RunningTaskCount`, CPU/mémoire et les événements de service confirment que les applications répondent. Les métriques API Gateway `Count`, `Latency`, `IntegrationLatency`, `4xx` et `5xx` permettent de diagnostiquer la partie amont non corrélée.

## Coût et performance

Aucun VPC endpoint et aucun NAT Gateway supplémentaires ne sont créés: le endpoint X-Ray existant est réutilisé avec un security group dédié. Le daemon X-Ray est remplacé, pas doublé. Le collector réserve 128 MiB, est limité à 256 MiB et reçoit 32 unités CPU par tâche; cela consomme une partie des ressources déjà allouées à la tâche Fargate, sans augmenter ici sa taille facturée. Les principaux coûts variables sont l'ingestion et la conservation X-Ray, ainsi que les logs CloudWatch du collector. Ils dépendent du volume de requêtes et du taux de sampling.

Le traitement applicatif ajoute la création de quelques spans en mémoire. L'export est asynchrone et local; le batch n'est pas sur le chemin critique. La file est bornée à 512 spans et les délais d'export à 2 secondes. La configuration évite l'auto-instrumentation et limite le volume, la consommation mémoire et la cardinalité.
