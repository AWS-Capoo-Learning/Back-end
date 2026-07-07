import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand
} from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.USERS_TABLE;
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://127.0.0.1:3000",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
  "Access-Control-Allow-Methods": "GET,OPTIONS"
};

export const handler = async (event) => {
  const method =
    event.httpMethod ?? event.requestContext?.http?.method;

  if (method === "OPTIONS") {
    return response(204, "");
  }
  const userId = event.pathParameters?.userId;
  if (!userId) {
    return response(400, {
      message: "Missing userId path parameter"
    });
  }

  const result = await db.send(new GetCommand({
    TableName: tableName,
    Key: { userId }
  }));

  if (!result.Item) {
    return response(404, {
      message: "User not found"
    });
  }

  const user = result.Item;

  return response(200, {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    role: user.role,
    provider: user.provider,
    isExternal: user.isExternal,
    iss: user.iss,
    createdAt: user.createdAt
  });
};

function parseGroups(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }

  return String(value)
    .split(",")
    .map((group) => group.trim());
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    },
    body: body === "" ? "" : JSON.stringify(body)
  };
}
