import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand
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

  const claims = event.requestContext?.authorizer?.claims;
  if (!claims) {
    return response(401, {
      message: "Unauthorized: missing Cognito claims"
    });
  }
  const groups = parseGroups(claims["cognito:groups"]);

  if (!groups.includes("admin")) {
    return response(403, {
      message: "Admin permission  required"
    });
  }

  const result = await db.send(new ScanCommand({
    TableName: tableName,
    Limit: 50
  }));

  const users = (result.Items ?? []).map((user) => ({
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    role: user.role,
    provider: user.provider,
    isExternal: user.isExternal,
    iss: user.iss,
    createdAt: user.createdAt
  }));

  return response(200, {
    users,
    count: users.length,
    lastEvaluatedKey: result.LastEvaluatedKey
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
    // Cognito có thể trả group dưới dạng chuỗi.
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
