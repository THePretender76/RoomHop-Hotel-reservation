import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { CONFIG } from './config';

export interface PipelineStackProps extends cdk.StackProps {
  searchRepository: ecr.IRepository;
  reservationRepository: ecr.IRepository;
  collectorRepository: ecr.IRepository;
  metabaseRepository: ecr.IRepository;
  searchService: ecs.IBaseService;
  reservationService: ecs.IBaseService;
  metabaseService: ecs.IBaseService;
  websiteBucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const githubOwner = new cdk.CfnParameter(this, 'GitHubOwner', {
      type: 'String',
      description: 'GitHub organization or username containing the RoomHop repository',
    });
    const githubRepository = new cdk.CfnParameter(this, 'GitHubRepository', {
      type: 'String',
      default: 'RoomHop-Hotel-reservation',
    });
    const githubBranch = new cdk.CfnParameter(this, 'GitHubBranch', {
      type: 'String',
      default: 'master',
    });
    const githubConnectionArn = new cdk.CfnParameter(this, 'GitHubConnectionArn', {
      type: 'String',
      description: 'ARN of the AVAILABLE GitHub CodeConnections connection.',
    });

    const source = new codepipeline.Artifact('Source');
    const images = new codepipeline.Artifact('ContainerImages');
    const frontend = new codepipeline.Artifact('Frontend');

    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: `${CONFIG.projectName}-pipeline`,
      pipelineType: codepipeline.PipelineType.V2,
      executionMode: codepipeline.ExecutionMode.SUPERSEDED,
      restartExecutionOnUpdate: true,
    });
    pipeline.addStage({
      stageName: 'Source',
      actions: [new actions.CodeStarConnectionsSourceAction({
        actionName: 'GitHub',
        owner: githubOwner.valueAsString,
        repo: githubRepository.valueAsString,
        branch: githubBranch.valueAsString,
        connectionArn: githubConnectionArn.valueAsString,
        output: source,
        triggerOnPush: true,
      })],
    });

    const validation = new codebuild.PipelineProject(this, 'ValidationBuild', {
      projectName: `${CONFIG.projectName}-validate`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs: 22 },
            commands: [
              'npm ci --prefix hotel-ui',
              'npm ci --prefix services/search-service',
              'npm ci --prefix services/reservation-service',
              'npm ci --prefix services/lambda/notification-handler',
              'npm ci --prefix services/lambda/analytics-handler',
              'npm ci --prefix services/lambda/db-migration',
              'npm ci --prefix services/lambda/metabase-db-init',
              'npm ci --prefix infra',
            ],
          },
          build: {
            commands: [
              'npm run lint --prefix hotel-ui',
              'npm test --prefix hotel-ui',
              'npm test --prefix services/search-service',
              'npm test --prefix services/reservation-service',
              'npm test --prefix services/lambda/notification-handler',
              'npm test --prefix services/lambda/analytics-handler',
              'npm test --prefix services/lambda/db-migration',
              'npm test --prefix services/lambda/metabase-db-init',
              'npm run build --prefix infra',
              'npm run synth --prefix infra',
            ],
          },
        },
      }),
    });

    const imageBuild = new codebuild.PipelineProject(this, 'ContainerBuild', {
      projectName: `${CONFIG.projectName}-containers`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
        privileged: true,
        environmentVariables: {
          SEARCH_REPOSITORY_URI: { value: props.searchRepository.repositoryUri },
          RESERVATION_REPOSITORY_URI: { value: props.reservationRepository.repositoryUri },
          COLLECTOR_REPOSITORY_URI: { value: props.collectorRepository.repositoryUri },
          METABASE_REPOSITORY_URI: { value: props.metabaseRepository.repositoryUri },
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'REGISTRY=$(echo "$SEARCH_REPOSITORY_URI" | cut -d/ -f1)',
              'aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"',
              'IMAGE_TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION:-latest}',
            ],
          },
          build: {
            commands: [
              'docker build -t "$SEARCH_REPOSITORY_URI:$IMAGE_TAG" services/search-service',
              'docker build -t "$RESERVATION_REPOSITORY_URI:$IMAGE_TAG" services/reservation-service',
              'docker build -t "$COLLECTOR_REPOSITORY_URI:$IMAGE_TAG" infra/docker/adot',
              'docker build -t "$METABASE_REPOSITORY_URI:$IMAGE_TAG" infra/docker/metabase',
              'docker push "$SEARCH_REPOSITORY_URI:$IMAGE_TAG"',
              'docker push "$RESERVATION_REPOSITORY_URI:$IMAGE_TAG"',
              'docker push "$COLLECTOR_REPOSITORY_URI:$IMAGE_TAG"',
              'docker push "$METABASE_REPOSITORY_URI:$IMAGE_TAG"',
            ],
          },
          post_build: {
            commands: [
              `printf '[{"name":"SearchContainer","imageUri":"%s"},{"name":"SearchAdotCollector","imageUri":"%s"}]' "$SEARCH_REPOSITORY_URI:$IMAGE_TAG" "$COLLECTOR_REPOSITORY_URI:$IMAGE_TAG" > search-images.json`,
              `printf '[{"name":"ReservationContainer","imageUri":"%s"},{"name":"ReservationAdotCollector","imageUri":"%s"}]' "$RESERVATION_REPOSITORY_URI:$IMAGE_TAG" "$COLLECTOR_REPOSITORY_URI:$IMAGE_TAG" > reservation-images.json`,
              `printf '[{"name":"MetabaseContainer","imageUri":"%s"}]' "$METABASE_REPOSITORY_URI:$IMAGE_TAG" > metabase-images.json`,
            ],
          },
        },
        artifacts: {
          files: ['search-images.json', 'reservation-images.json', 'metabase-images.json'],
        },
      }),
    });
    props.searchRepository.grantPullPush(imageBuild);
    props.reservationRepository.grantPullPush(imageBuild);
    props.collectorRepository.grantPullPush(imageBuild);
    props.metabaseRepository.grantPullPush(imageBuild);

    const frontendBuild = new codebuild.PipelineProject(this, 'FrontendBuild', {
      projectName: `${CONFIG.projectName}-frontend`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        environmentVariables: {
          VITE_COGNITO_USER_POOL_ID: { value: props.userPool.userPoolId },
          VITE_COGNITO_CLIENT_ID: { value: props.userPoolClient.userPoolClientId },
          VITE_AWS_REGION: { value: CONFIG.region },
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs: 22 },
            commands: ['npm ci --prefix hotel-ui'],
          },
          build: { commands: ['npm run build --prefix hotel-ui'] },
        },
        artifacts: {
          'base-directory': 'hotel-ui/dist',
          files: ['**/*'],
        },
      }),
    });

    pipeline.addStage({
      stageName: 'BuildAndTest',
      actions: [
        new actions.CodeBuildAction({
          actionName: 'Validate',
          project: validation,
          input: source,
          runOrder: 1,
        }),
        new actions.CodeBuildAction({
          actionName: 'Containers',
          project: imageBuild,
          input: source,
          outputs: [images],
          runOrder: 2,
        }),
        new actions.CodeBuildAction({
          actionName: 'Frontend',
          project: frontendBuild,
          input: source,
          outputs: [frontend],
          runOrder: 2,
        }),
      ],
    });

    const invalidation = new codebuild.PipelineProject(this, 'CloudFrontInvalidation', {
      projectName: `${CONFIG.projectName}-cloudfront-invalidation`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        environmentVariables: {
          DISTRIBUTION_ID: { value: props.distribution.distributionId },
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: ['aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*"'],
          },
        },
      }),
    });
    invalidation.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation'],
      resources: [
        `arn:${cdk.Aws.PARTITION}:cloudfront::${cdk.Aws.ACCOUNT_ID}:distribution/${props.distribution.distributionId}`,
      ],
    }));

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new actions.EcsDeployAction({
          actionName: 'SearchService',
          service: props.searchService,
          imageFile: images.atPath('search-images.json'),
          runOrder: 1,
        }),
        new actions.EcsDeployAction({
          actionName: 'ReservationService',
          service: props.reservationService,
          imageFile: images.atPath('reservation-images.json'),
          runOrder: 1,
        }),
        new actions.EcsDeployAction({
          actionName: 'Metabase',
          service: props.metabaseService,
          imageFile: images.atPath('metabase-images.json'),
          runOrder: 1,
        }),
        new actions.S3DeployAction({
          actionName: 'FrontendAssets',
          input: frontend,
          bucket: props.websiteBucket,
          extract: true,
          runOrder: 1,
        }),
        new actions.CodeBuildAction({
          actionName: 'InvalidateCloudFront',
          project: invalidation,
          input: source,
          runOrder: 2,
        }),
      ],
    });

    new cdk.CfnOutput(this, 'PipelineName', { value: pipeline.pipelineName });
    new cdk.CfnOutput(this, 'ConfiguredGitHubConnectionArn', {
      value: githubConnectionArn.valueAsString,
      description: 'GitHub CodeConnections connection used by the pipeline source.',
    });
  }
}
