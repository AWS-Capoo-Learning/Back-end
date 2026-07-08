import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand
} from "@aws-sdk/client-cognito-identity-provider";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

export const handler = async (event) => {
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
    return event;
  }

  const attributes = event.request.userAttributes;
  const userId = randomUUID();
  const passwordTime = String(Math.floor(Date.now() / 1000));
  const identities = parseIdentities(attributes.identities);
  const isExternal = identities.length > 0;
  const provider = isExternal
    ? identities[0]?.providerName ?? identities[0]?.providerType ?? "EXTERNAL"
    : "COGNITO";
  const iss =
    identities[0]?.issuer ??
    `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${event.userPoolId}`;
  const normalizedEmail = attributes.email?.trim().toLowerCase();
  const createdAt = new Date().toISOString();

  const existingUser = await findUserByEmailAndProvider(
    normalizedEmail,
    provider
  );

  if (existingUser) {
    await deleteCognitoUser(event);
    throw new Error("Email and provider already exists");
  }

  await db.send(new PutCommand({
    TableName: process.env.USERS_TABLE,
    Item: {
      userId,
      cognitoSub: attributes.sub,
      email: normalizedEmail,
      displayName: attributes.name ?? "",
      status: "ACTIVE",
      role: "USER",
      provider,
      isExternal,
      iss,
      createdAt
    },
    ConditionExpression: "attribute_not_exists(userId)"
  }));

  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName,
    GroupName: process.env.DEFAULT_GROUP ?? "user"
  }));

  await cognito.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName,
    UserAttributes: [
      {
        Name: "custom:password_time",
        Value: passwordTime
      },
      {
        Name: "custom:id",
        Value: userId
      }
    ]
  }));

  return event;
};

async function deleteCognitoUser(event) {
  await cognito.send(new AdminDeleteUserCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName
  }));
}

function parseIdentities(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function findUserByEmailAndProvider(email, provider) {
  const result = await db.send(new ScanCommand({
    TableName: process.env.USERS_TABLE,
    FilterExpression: "email = :email AND provider = :provider",
    ExpressionAttributeValues: {
      ":email": email,
      ":provider": provider
    },
    Limit: 1
  }));

  return result.Items?.[0];
}
