import * as cdk from 'aws-cdk-lib';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dms from 'aws-cdk-lib/aws-dms';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { CONFIG } from '../config';

export interface NamedEcsService {
  readonly label: string;
  readonly service: ecs.BaseService;
}

export interface NamedQueue {
  readonly label: string;
  readonly queue: sqs.IQueue;
}

export interface NamedFunction {
  readonly label: string;
  readonly function: lambda.IFunction;
}

export interface RoomHopOperationsDashboardProps {
  readonly alb: elbv2.IApplicationLoadBalancer;
  readonly cluster: ecs.ICluster;
  readonly ecsServices: NamedEcsService[];
  readonly database: rds.IDatabaseInstance;
  readonly searchDomain: opensearch.IDomain;
  readonly queues: NamedQueue[];
  readonly deadLetterQueues: NamedQueue[];
  readonly functions: NamedFunction[];
  readonly dlqAlarms: cloudwatch.IAlarm[];
  readonly replicationTask: dms.CfnReplicationTask;
  readonly replicationInstance: dms.CfnReplicationInstance;
}

const PERIOD = cdk.Duration.minutes(1);

export class RoomHopOperationsDashboard extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: RoomHopOperationsDashboardProps) {
    super(scope, id);

    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${CONFIG.projectName}-operations`,
      start: '-PT8H',
      periodOverride: cloudwatch.PeriodOverride.INHERIT,
    });

    const apiRequests = props.alb.metrics.requestCount({
      period: PERIOD,
      statistic: cloudwatch.Stats.SUM,
      label: 'Requests forwarded to targets',
    });
    const apiClientErrors = props.alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_4XX_COUNT, {
      period: PERIOD,
      statistic: cloudwatch.Stats.SUM,
      label: 'Target 4xx',
    });
    const apiServerErrors = props.alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
      period: PERIOD,
      statistic: cloudwatch.Stats.SUM,
      label: 'Target 5xx',
    });
    const apiErrorRate = new cloudwatch.MathExpression({
      expression: 'IF(requests > 0, 100 * (clientErrors + serverErrors) / requests, 0)',
      usingMetrics: {
        requests: apiRequests,
        clientErrors: apiClientErrors,
        serverErrors: apiServerErrors,
      },
      period: PERIOD,
      label: 'Target error rate (%)',
    });

    const dlqMetrics = Object.fromEntries(props.deadLetterQueues.map(({ queue }, index) => [
      `dlq${index}`,
      queue.metricApproximateNumberOfMessagesVisible({
        period: PERIOD,
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
    ]));
    const totalDlqMessages = new cloudwatch.MathExpression({
      expression: Object.keys(dlqMetrics).join(' + '),
      usingMetrics: dlqMetrics,
      period: PERIOD,
      label: 'Total visible DLQ messages',
    });

    this.addHeaderAndAlarms(props.dlqAlarms);
    this.addOverview(apiRequests, apiErrorRate, totalDlqMessages, props.functions);
    this.addApiSection(props.alb, apiRequests, apiClientErrors, apiServerErrors, apiErrorRate);
    this.addEcsSection(props.cluster, props.ecsServices);
    this.addDataSection(props.database, props.searchDomain);
    this.addMessagingSection(props.queues, props.deadLetterQueues, totalDlqMessages);
    this.addLambdaSection(props.functions);
    this.addDmsSection(props.replicationTask, props.replicationInstance);
  }

  private addHeaderAndAlarms(alarms: cloudwatch.IAlarm[]): void {
    this.dashboard.addWidgets(new cloudwatch.TextWidget({
      width: 24,
      height: 2,
      markdown: '# RoomHop Operations\nOperational health across API, compute, data and events.',
    }));
    this.dashboard.addWidgets(...alarms.map((alarm) => new cloudwatch.AlarmWidget({
      width: 12,
      height: 5,
      title: alarm.alarmName,
      alarm,
    })));
  }

  private addOverview(
    apiRequests: cloudwatch.IMetric,
    apiErrorRate: cloudwatch.IMetric,
    totalDlqMessages: cloudwatch.IMetric,
    functions: NamedFunction[]
  ): void {
    const totalLambdaErrors = new cloudwatch.MathExpression({
      expression: functions.map((_, index) => `errors${index}`).join(' + '),
      usingMetrics: Object.fromEntries(functions.map(({ function: fn }, index) => [
        `errors${index}`,
        fn.metricErrors({ period: PERIOD, statistic: cloudwatch.Stats.SUM }),
      ])),
      period: PERIOD,
      label: 'Total Lambda errors',
    });

    this.dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        width: 6,
        height: 4,
        title: 'Requests forwarded to ALB targets',
        metrics: [apiRequests],
      }),
      new cloudwatch.SingleValueWidget({
        width: 6,
        height: 4,
        title: 'ALB target error rate',
        metrics: [apiErrorRate],
      }),
      new cloudwatch.SingleValueWidget({
        width: 6,
        height: 4,
        title: 'Messages in DLQs',
        metrics: [totalDlqMessages],
      }),
      new cloudwatch.SingleValueWidget({
        width: 6,
        height: 4,
        title: 'Lambda errors',
        metrics: [totalLambdaErrors],
      }),
    );
  }

  private addApiSection(
    alb: elbv2.IApplicationLoadBalancer,
    requests: cloudwatch.IMetric,
    clientErrors: cloudwatch.IMetric,
    serverErrors: cloudwatch.IMetric,
    errorRate: cloudwatch.IMetric
  ): void {
    this.dashboard.addWidgets(new cloudwatch.TextWidget({
      width: 24,
      height: 3,
      markdown: '## Private ALB\nMetrics aggregate Search, Reservation/Admin and Metabase. Target errors and ALB-generated errors are separate. Native ALB metrics do not identify individual URL routes. RequestCount excludes requests rejected before a target is selected.',
    }));
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'Forwarded requests and target errors',
        left: [requests, clientErrors, serverErrors],
        right: [errorRate],
        rightYAxis: { min: 0, max: 100, label: 'Percent' },
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'Target response time',
        left: [
          alb.metrics.targetResponseTime({ period: PERIOD, statistic: 'p95', label: 'Target p95' }),
          alb.metrics.targetResponseTime({ period: PERIOD, statistic: 'p99', label: 'Target p99' }),
        ],
        leftYAxis: { min: 0, label: 'Seconds' },
      }),
    );
    this.dashboard.addWidgets(new cloudwatch.GraphWidget({
      width: 24,
      height: 6,
      title: 'ALB-generated errors (before target response)',
      left: [
        alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_4XX_COUNT, {
          period: PERIOD, statistic: cloudwatch.Stats.SUM, label: 'ALB 4xx',
        }),
        alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
          period: PERIOD, statistic: cloudwatch.Stats.SUM, label: 'ALB 5xx',
        }),
      ],
    }));
  }

  private addEcsSection(cluster: ecs.ICluster, services: NamedEcsService[]): void {
    this.dashboard.addWidgets(new cloudwatch.TextWidget({
      width: 24,
      height: 1,
      markdown: '## ECS services',
    }));
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'ECS CPU utilization',
        left: services.map(({ label, service }) => service.metricCpuUtilization({
          period: PERIOD,
          statistic: cloudwatch.Stats.AVERAGE,
          label,
        })),
        leftYAxis: { min: 0, max: 100, label: 'Percent' },
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'ECS memory utilization',
        left: services.map(({ label, service }) => service.metricMemoryUtilization({
          period: PERIOD,
          statistic: cloudwatch.Stats.AVERAGE,
          label,
        })),
        leftYAxis: { min: 0, max: 100, label: 'Percent' },
      }),
      new cloudwatch.GraphWidget({
        width: 24,
        height: 6,
        title: 'ECS running and pending tasks (existing Container Insights)',
        left: services.flatMap(({ label, service }) => [
          this.containerInsightsMetric('RunningTaskCount', cluster, service, `${label} running`),
          this.containerInsightsMetric('PendingTaskCount', cluster, service, `${label} pending`),
        ]),
        leftYAxis: { min: 0, label: 'Tasks' },
      }),
    );
  }

  private addDataSection(database: rds.IDatabaseInstance, domain: opensearch.IDomain): void {
    this.dashboard.addWidgets(new cloudwatch.TextWidget({
      width: 24,
      height: 1,
      markdown: '## Data stores',
    }));
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'RDS CPU and connections',
        left: [database.metricCPUUtilization({ period: PERIOD, label: 'CPU' })],
        right: [database.metricDatabaseConnections({ period: PERIOD, label: 'Connections' })],
        leftYAxis: { min: 0, max: 100, label: 'Percent' },
        rightYAxis: { min: 0, label: 'Connections' },
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'RDS available capacity',
        left: [
          database.metricFreeStorageSpace({ period: PERIOD, statistic: cloudwatch.Stats.MINIMUM }),
          database.metricFreeableMemory({ period: PERIOD, statistic: cloudwatch.Stats.MINIMUM }),
        ],
        leftYAxis: { min: 0, label: 'Bytes' },
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'OpenSearch compute pressure',
        left: [
          domain.metricCPUUtilization({ period: PERIOD, label: 'CPU' }),
          domain.metricJVMMemoryPressure({ period: PERIOD, label: 'JVM memory pressure' }),
        ],
        leftYAxis: { min: 0, max: 100, label: 'Percent' },
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'OpenSearch health and free storage',
        left: [
          domain.metricClusterStatusYellow({ period: PERIOD, label: 'Yellow' }),
          domain.metricClusterStatusRed({ period: PERIOD, label: 'Red' }),
          domain.metricClusterIndexWritesBlocked({ period: PERIOD, label: 'Writes blocked' }),
        ],
        right: [domain.metricFreeStorageSpace({ period: PERIOD, label: 'Free storage' })],
        leftYAxis: { min: 0, max: 1, label: 'State' },
        rightYAxis: { min: 0, label: 'MiB' },
      }),
    );
  }

  private addMessagingSection(
    queues: NamedQueue[],
    deadLetterQueues: NamedQueue[],
    totalDlqMessages: cloudwatch.IMetric
  ): void {
    this.dashboard.addWidgets(new cloudwatch.TextWidget({
      width: 24,
      height: 1,
      markdown: '## SQS queues and dead-letter queues',
    }));
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'Queue backlog',
        left: queues.map(({ label, queue }) => queue.metricApproximateNumberOfMessagesVisible({
          period: PERIOD,
          statistic: cloudwatch.Stats.MAXIMUM,
          label,
        })),
        leftYAxis: { min: 0, label: 'Messages' },
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'DLQ messages and oldest message age',
        left: [totalDlqMessages],
        right: deadLetterQueues.map(({ label, queue }) => queue.metricApproximateAgeOfOldestMessage({
          period: PERIOD,
          statistic: cloudwatch.Stats.MAXIMUM,
          label: `${label} age`,
        })),
        leftYAxis: { min: 0, label: 'Messages' },
        rightYAxis: { min: 0, label: 'Seconds' },
      }),
    );
  }

  private addLambdaSection(functions: NamedFunction[]): void {
    this.dashboard.addWidgets(new cloudwatch.TextWidget({
      width: 24,
      height: 1,
      markdown: '## Lambda functions',
    }));
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'Lambda invocations and errors',
        left: functions.map(({ label, function: fn }) => fn.metricInvocations({
          period: PERIOD,
          statistic: cloudwatch.Stats.SUM,
          label: `${label} invocations`,
        })),
        right: functions.map(({ label, function: fn }) => fn.metricErrors({
          period: PERIOD,
          statistic: cloudwatch.Stats.SUM,
          label: `${label} errors`,
        })),
        leftYAxis: { min: 0, label: 'Invocations' },
        rightYAxis: { min: 0, label: 'Errors' },
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'Lambda duration p95 and throttles',
        left: functions.map(({ label, function: fn }) => fn.metricDuration({
          period: PERIOD,
          statistic: 'p95',
          label: `${label} duration p95`,
        })),
        right: functions.map(({ label, function: fn }) => fn.metricThrottles({
          period: PERIOD,
          statistic: cloudwatch.Stats.SUM,
          label: `${label} throttles`,
        })),
        leftYAxis: { min: 0, label: 'Milliseconds' },
        rightYAxis: { min: 0, label: 'Throttles' },
      }),
    );
  }

  private addDmsSection(
    replicationTask: dms.CfnReplicationTask,
    replicationInstance: dms.CfnReplicationInstance
  ): void {
    const dimensionsMap = {
      ReplicationInstanceIdentifier: replicationInstance.replicationInstanceIdentifier!,
      ReplicationTaskIdentifier: replicationTask.replicationTaskIdentifier!,
    };
    const dmsMetric = (metricName: string, label: string, statistic = cloudwatch.Stats.MAXIMUM) =>
      new cloudwatch.Metric({
        namespace: 'AWS/DMS',
        metricName,
        dimensionsMap,
        period: PERIOD,
        statistic,
        label,
      });

    this.dashboard.addWidgets(new cloudwatch.TextWidget({
      width: 24,
      height: 1,
      markdown: '## Database Migration Service',
    }));
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'DMS CDC latency',
        left: [
          dmsMetric('CDCLatencySource', 'Source latency'),
          dmsMetric('CDCLatencyTarget', 'Target latency'),
        ],
        leftYAxis: { min: 0, label: 'Seconds' },
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'DMS CDC throughput',
        left: [
          dmsMetric('CDCIncomingChanges', 'Incoming changes', cloudwatch.Stats.SUM),
          dmsMetric('CDCThroughputRowsTarget', 'Applied rows/second', cloudwatch.Stats.AVERAGE),
        ],
        leftYAxis: { min: 0, label: 'Changes' },
      }),
    );
  }

  private containerInsightsMetric(
    metricName: string,
    cluster: ecs.ICluster,
    service: ecs.BaseService,
    label: string
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: 'ECS/ContainerInsights',
      metricName,
      dimensionsMap: {
        ClusterName: cluster.clusterName,
        ServiceName: service.serviceName,
      },
      period: PERIOD,
      statistic: cloudwatch.Stats.AVERAGE,
      label,
    });
  }
}
