import { CognitoJwtVerifier } from "aws-jwt-verify";
import {
  DynamoDBClient,
  GetItemCommand
} from "@aws-sdk/client-dynamodb";

const db = new DynamoDBClient({});

const userPoolId =
  process.env.USER_POOL_ID ?? "us-east-1_ZpmfeJQa0";

const clientId =
  process.env.CLIENT_ID ?? "3g9jtov6i965ilnqs5jm518k7e";

const revokedTokensTable =
  process.env.REVOKED_TOKENS_TABLE ?? "revoked-tokens";

const verifier = CognitoJwtVerifier.create({
  userPoolId,
  tokenUse: "id",
  clientId
});

export const handler = async (event) => {
  try {
    const rawAuthorization =
      event.authorizationToken ??
      event.headers?.Authorization ??
      event.headers?.authorization;

    const token = rawAuthorization?.replace(
      /^Bearer\s+/i,
      ""
    );

    if (!token) {
      throw new Error("Missing Authorization token");
    }

    // Kiểm tra chữ ký, issuer, client ID, token_use và expiration.
    const payload = await verifier.verify(token);

    const tokenId =
      payload.origin_jti ?? payload.jti;

    if (!tokenId) {
      throw new Error("Missing token identifier");
    }

    const revoked = await db.send(
      new GetItemCommand({
        TableName: revokedTokensTable,
        Key: {
          tokenId: {
            S: tokenId
          }
        }
      })
    );

    if (revoked.Item) {
      throw new Error("Token revoked");
    }

    return generatePolicy(
      "Allow",
      event.methodArn,
      {
        sub: payload.sub,
        username:
          payload["cognito:username"] ?? "",
        groups: JSON.stringify(
          payload["cognito:groups"] ?? []
        ),
        tokenId,
        expiresAt: String(payload.exp)
      }
    );
  } catch (error) {
    console.error("Authorizer denied request:", {
      name: error.name,
      message: error.message
    });

    return generatePolicy(
      "Deny",
      event.methodArn
    );
  }
};

function generatePolicy(
  effect,
  resource,
  context = {}
) {
  return {
    principalId: context.sub ?? "anonymous",
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: effect,
          Resource: resource
        }
      ]
    },
    context
  };
}