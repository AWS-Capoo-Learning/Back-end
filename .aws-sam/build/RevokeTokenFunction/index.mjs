import {
  DynamoDBClient,
  PutItemCommand
} from "@aws-sdk/client-dynamodb";

const db = new DynamoDBClient({});

export const handler = async (event) => {
  const authorizer = event.requestContext?.authorizer ?? {};
  const claims = authorizer.claims ?? {};

  const tokenId =
    authorizer.tokenId ??
    claims.origin_jti ??
    claims.jti;

  const userId =
    authorizer.sub ??
    claims.sub;

  const rawExpiration =
    authorizer.expiresAt ??
    claims.exp;

  if (!tokenId || !userId || !rawExpiration) {
    return response(401, {
      message: "Missing authenticated token information"
    });
  }

  const expiresAt = toEpochSeconds(rawExpiration);

  await db.send(new PutItemCommand({
    TableName: "revoked-tokens",
    Item: {
      tokenId: {
        S: String(tokenId)
      },
      userId: {
        S: String(userId)
      },
      expiresAt: {
        N: String(expiresAt)
      },
      revokedAt: {
        S: new Date().toISOString()
      }
    }
  }));

  return response(200, {
    message: "Token revoked successfully"
  });
};

function toEpochSeconds(value) {
  const numericValue = Number(value);

  if (Number.isFinite(numericValue)) {
    return Math.floor(numericValue);
  }

  const milliseconds = Date.parse(value);

  if (Number.isNaN(milliseconds)) {
    throw new Error(`Invalid token expiration: ${value}`);
  }

  return Math.floor(milliseconds / 1000);
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}