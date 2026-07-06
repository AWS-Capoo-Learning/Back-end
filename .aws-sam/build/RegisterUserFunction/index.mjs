import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand
} from "@aws-sdk/client-cognito-identity-provider";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

export const handler = async (event) => {
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
    return event;
  }

  const attributes = event.request.userAttributes;

  try {
    await db.send(new PutCommand({
      TableName: process.env.USERS_TABLE,
      Item: {
        userId: attributes.sub,
        email: attributes.email,
        displayName: attributes.name ?? "",
        status: "ACTIVE",
        role: "USER",
        createdAt: new Date().toISOString()
      },
      ConditionExpression: "attribute_not_exists(userId)"
    }));
  } catch (error) {
    if (error.name !== "ConditionalCheckFailedException") {
      throw error;
    }
  }

  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName,
    GroupName: process.env.DEFAULT_GROUP ?? "user"
  }));

  return event;
};