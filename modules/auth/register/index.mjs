import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
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
  const emailProviderKey = buildEmailProviderKey(normalizedEmail, provider);
  const createdAt = new Date().toISOString();

  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: process.env.USERS_TABLE,
            Item: {
              userId: emailProviderKey,
              _type: "EMAIL_PROVIDER_UNIQUE",
              email: normalizedEmail,
              provider,
              ownerUserId: userId,
              cognitoSub: attributes.sub,
              createdAt
            },
            ConditionExpression: "attribute_not_exists(userId)"
          }
        },
        {
          Put: {
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
              emailProviderKey,
              createdAt
            },
            ConditionExpression: "attribute_not_exists(userId)"
          }
        }
      ]
    }));
  } catch (error) {
    if (error.name === "TransactionCanceledException") {
      throw new Error("Email and provider already exists");
    }

    throw error;
  }

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

function buildEmailProviderKey(email, provider) {
  return `EMAIL_PROVIDER#${provider.toLowerCase()}#${email}`;
}
