import {
  ChangePasswordCommand,
  CognitoIdentityProviderClient,
  UpdateUserAttributesCommand
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://127.0.0.1:3000",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

export const handler = async (event) => {
  const method =
    event.httpMethod ?? event.requestContext?.http?.method;

  if (method === "OPTIONS") {
    return response(204, "");
  }

  const body = parseBody(event.body);
  const accessToken = body.accessToken;
  const previousPassword =
    body.previousPassword ?? body.currentPassword ?? body.oldPassword;
  const proposedPassword =
    body.proposedPassword ?? body.newPassword;

  if (!accessToken || !previousPassword || !proposedPassword) {
    return response(400, {
      message: "Missing accessToken, previousPassword, or proposedPassword"
    });
  }

  if (previousPassword === proposedPassword) {
    return response(400, {
      message: "New password must be different from current password"
    });
  }

  try {
    await cognito.send(new ChangePasswordCommand({
      AccessToken: accessToken,
      PreviousPassword: previousPassword,
      ProposedPassword: proposedPassword
    }));

    await cognito.send(new UpdateUserAttributesCommand({
      AccessToken: accessToken,
      UserAttributes: [
        {
          Name: "custom:password_time",
          Value: String(Math.floor(Date.now() / 1000))
        }
      ]
    }));

    return response(200, {
      message: "Password changed successfully"
    });
  } catch (error) {
    console.error("Change password failed:", {
      name: error.name,
      message: error.message
    });

    return response(statusCodeFor(error), {
      message: messageFor(error)
    });
  }
};

function parseBody(rawBody) {
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return {};
  }
}

function statusCodeFor(error) {
  switch (error.name) {
    case "NotAuthorizedException":
    case "UserNotConfirmedException":
      return 401;
    case "InvalidPasswordException":
    case "PasswordHistoryPolicyViolationException":
      return 400;
    case "LimitExceededException":
    case "TooManyRequestsException":
      return 429;
    default:
      return 500;
  }
}

function messageFor(error) {
  switch (error.name) {
    case "NotAuthorizedException":
      return "Current password is incorrect, or this account uses social sign-in.";
    case "InvalidPasswordException":
      return "The new password does not meet the Cognito password policy.";
    case "PasswordHistoryPolicyViolationException":
      return "This password was used previously. Choose a different password.";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Please wait and try again.";
    case "UserNotConfirmedException":
      return "Confirm your account before changing the password.";
    default:
      return "Unable to change password. Please try again.";
  }
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
