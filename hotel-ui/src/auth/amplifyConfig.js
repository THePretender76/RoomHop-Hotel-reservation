// Cognito configuration — only active when env vars are set
export const cognitoConfig = {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
};

export const isAuthEnabled = () => !!cognitoConfig.userPoolId && !!cognitoConfig.userPoolClientId;
