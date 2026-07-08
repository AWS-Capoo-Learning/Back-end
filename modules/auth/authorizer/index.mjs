import { CognitoJwtVerifier } from "aws-jwt-verify";
import {
  DynamoDBClient,
  GetItemCommand
} from "@aws-sdk/client-dynamodb";

const db = new DynamoDBClient({});

const revokedTokensTable =
  process.env.REVOKED_TOKENS_TABLE ?? "revoked-tokens";

const verifier = CognitoJwtVerifier.create(getAuthConfigs());

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
    const provider = getProvider(payload);
    const isExternalProvider = provider !== "COGNITO";

    const tokenId =
      payload.origin_jti ?? payload.jti;

    if (!tokenId) {
      throw new Error("Missing token identifier");
    }
    //Kiểm tra token đã bị thu hồi chưa
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
    // Kiểm tra xem mật khẩu còn hạn hay chưa nếu là tài khoản internal
    const isInternalUser = !isExternalProvider;

    if (isInternalUser) {
      const now = Math.floor(Date.now() / 1000);
      const passwordTime = Number(payload["custom:password_time"] ?? 0);
      if (
        now - passwordTime >5*60*60 &&
        !isChangePasswordRequest(event.methodArn)
      ) {
        return generatePolicy(
          "Deny",
          event.methodArn,
          {
            errorMessage: "Password expired"
          }
        );      
      }
    }


    // Trả về
    return generatePolicy(
      "Allow",
      event.methodArn,
      {
        sub: payload.sub,
        userId: payload["custom:id"] ?? "",
        username:
          payload["cognito:username"] ?? "",
        groups: JSON.stringify(
          payload["cognito:groups"] ?? []
        ),
        iss: payload.iss ?? "",
        clientId: payload.aud ?? "",
        provider,
        isExternal: String(isExternalProvider),
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
      event.methodArn,
      {
        errorMessage: error.message ?? "Unauthorized"
      }
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

function isChangePasswordRequest(methodArn = "") {
  return String(methodArn).includes("/POST/auth/change-password");
}

function getAuthConfigs() {
  const configs = parseAuthConfigs(process.env.COGNITO_AUTH_CONFIGS);

  if (configs.length > 0) {
    return configs;
  }

  return {
    userPoolId: process.env.USER_POOL_ID ?? "us-east-1_ZpmfeJQa0",
    tokenUse: "id",
    clientId: process.env.CLIENT_ID ?? "3g9jtov6i965ilnqs5jm518k7e"
  };
}

function parseAuthConfigs(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((config) => ({
        userPoolId: config.userPoolId,
        tokenUse: "id",
        clientId: config.clientId
      }))
      .filter((config) => config.userPoolId && config.clientId);
  } catch {
    return [];
  }
}

function getProvider(payload) {
  const identities = payload.identities;

  if (!Array.isArray(identities) || identities.length === 0) {
    return "COGNITO";
  }

  return identities[0]?.providerName ?? identities[0]?.providerType ?? "EXTERNAL";
}
