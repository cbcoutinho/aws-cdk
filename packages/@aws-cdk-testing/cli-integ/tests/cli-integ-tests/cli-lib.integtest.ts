import { integTest, withCliLibFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('VPC Lookup', withCliLibFixture(async (fixture) => {
  fixture.log('Making sure we are clean before starting.');
  await fixture.cdkDestroy('define-vpc', { modEnv: { ENABLE_VPC_TESTING: 'DEFINE' } });

  fixture.log('Setting up: creating a VPC with known tags');
  await fixture.cdkDeploy('define-vpc', { modEnv: { ENABLE_VPC_TESTING: 'DEFINE' } });
  fixture.log('Setup complete!');

  fixture.log('Verifying we can now import that VPC');
  await fixture.cdkDeploy('import-vpc', { modEnv: { ENABLE_VPC_TESTING: 'IMPORT' } });
}));

// testing a construct with a builtin Nodejs Lambda Function.
// In this case we are testing the s3.Bucket construct with the
// autoDeleteObjects prop set to true, which creates a Lambda backed
// CustomResource. Since the compiled Lambda code (e.g. __entrypoint__.js)
// is bundled as part of the CDK package, we want to make sure we don't
// introduce changes to the compiled code that could prevent the Lambda from
// executing. If we do, this test will timeout and fail.

// withSamIntegrationFixture
integTest('Construct with builtin Lambda function', withCliLibFixture(async (fixture) => {
  await fixture.cdkDeploy('builtin-lambda-function');
  fixture.log('Setup complete!');
  await fixture.cdkDestroy('builtin-lambda-function');
}));

integTest('cdk synth', withCliLibFixture(async (fixture) => {
  await fixture.cdk(['synth', fixture.fullStackName('test-1')]);
  expect(fixture.template('test-1')).toEqual(expect.objectContaining({
    Resources: {
      topic69831491: {
        Type: 'AWS::SNS::Topic',
        Metadata: {
          'aws:cdk:path': `${fixture.stackNamePrefix}-test-1/topic/Resource`,
        },
      },
    },
  }));

  await fixture.cdk(['synth', fixture.fullStackName('test-2')], { verbose: false });
  expect(fixture.template('test-2')).toEqual(expect.objectContaining({
    Resources: {
      topic152D84A37: {
        Type: 'AWS::SNS::Topic',
        Metadata: {
          'aws:cdk:path': `${fixture.stackNamePrefix}-test-2/topic1/Resource`,
        },
      },
      topic2A4FB547F: {
        Type: 'AWS::SNS::Topic',
        Metadata: {
          'aws:cdk:path': `${fixture.stackNamePrefix}-test-2/topic2/Resource`,
        },
      },
    },
  }));
}));

integTest('deploy', withCliLibFixture(async (fixture) => {
  const stackArn = await fixture.cdkDeploy('test-2', { captureStderr: false });

  // verify the number of resources in the stack
  const response = await fixture.aws.cloudFormation('describeStackResources', {
    StackName: stackArn,
  });
  expect(response.StackResources?.length).toEqual(2);
}));

integTest('deploy --method=direct', withCliLibFixture(async (fixture) => {
  const stackArn = await fixture.cdkDeploy('test-2', {
    options: ['--method=direct'],
    captureStderr: false,
  });

  // verify the number of resources in the stack
  const response = await fixture.aws.cloudFormation('describeStackResources', {
    StackName: stackArn,
  });
  expect(response.StackResources?.length).toBeGreaterThan(0);
}));

integTest('deploy all', withCliLibFixture(async (fixture) => {
  const arns = await fixture.cdkDeploy('test-*', { captureStderr: false });

  // verify that we only deployed both stacks (there are 2 ARNs in the output)
  expect(arns.split('\n').length).toEqual(2);
}));

integTest('nested stack with parameters', withCliLibFixture(async (fixture) => {
  // STACK_NAME_PREFIX is used in MyTopicParam to allow multiple instances
  // of this test to run in parallel, othewise they will attempt to create the same SNS topic.
  const stackArn = await fixture.cdkDeploy('with-nested-stack-using-parameters', {
    options: ['--parameters', `MyTopicParam=${fixture.stackNamePrefix}ThereIsNoSpoon`],
    captureStderr: false,
  });

  // verify that we only deployed a single stack (there's a single ARN in the output)
  expect(stackArn.split('\n').length).toEqual(1);

  // verify the number of resources in the stack
  const response = await fixture.aws.cloudFormation('describeStackResources', {
    StackName: stackArn,
  });
  expect(response.StackResources?.length).toEqual(1);
}));

integTest('security related changes without a CLI are expected to fail', withCliLibFixture(async (fixture) => {
  // redirect /dev/null to stdin, which means there will not be tty attached
  // since this stack includes security-related changes, the deployment should
  // immediately fail because we can't confirm the changes
  const stackName = 'iam-test';
  await expect(fixture.cdkDeploy(stackName, {
    options: ['<', '/dev/null'], // H4x, this only works because I happen to know we pass shell: true.
    neverRequireApproval: false,
  })).rejects.toThrow('exited with error');

  // Ensure stack was not deployed
  await expect(fixture.aws.cloudFormation('describeStacks', {
    StackName: fixture.fullStackName(stackName),
  })).rejects.toThrow('does not exist');
}));

integTest('cdk diff', withCliLibFixture(async (fixture) => {
  const diff1 = await fixture.cdk(['diff', fixture.fullStackName('test-1')]);
  expect(diff1).toContain('AWS::SNS::Topic');

  const diff2 = await fixture.cdk(['diff', fixture.fullStackName('test-2')]);
  expect(diff2).toContain('AWS::SNS::Topic');

  // We can make it fail by passing --fail
  await expect(fixture.cdk(['diff', '--fail', fixture.fullStackName('test-1')]))
    .rejects.toThrow('exited with error');
}));

integTest('deploy stack with docker asset', withCliLibFixture(async (fixture) => {
  await fixture.cdkDeploy('docker');
}));

integTest('cdk ls', withCliLibFixture(async (fixture) => {
  const listing = await fixture.cdk(['ls'], { captureStderr: false });

  const expectedStacks = [
    'conditional-resource',
    'docker',
    'docker-with-custom-file',
    'failed',
    'iam-test',
    'lambda',
    'missing-ssm-parameter',
    'order-providing',
    'outputs-test-1',
    'outputs-test-2',
    'param-test-1',
    'param-test-2',
    'param-test-3',
    'termination-protection',
    'test-1',
    'test-2',
    'with-nested-stack',
    'with-nested-stack-using-parameters',
    'order-consuming',
  ];

  for (const stack of expectedStacks) {
    expect(listing).toContain(fixture.fullStackName(stack));
  }
}));
