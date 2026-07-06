import {
  DynamoDBClient,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({});

export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event));

  const userId = event.detail?.additionalEventData?.sub;
  const eventName = event.detail?.eventName;

  if (!userId || !eventName) {
    throw new Error("Missing Cognito sub or eventName");
  }

  const role =
    eventName === "AdminAddUserToGroup" ? "ADMIN" : "USER";

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: process.env.USERS_TABLE,
      Key: {
        userId: { S: userId },
      },
      UpdateExpression: "SET #role = :role",
      ConditionExpression: "attribute_exists(userId)",
      ExpressionAttributeNames: {
        "#role": "role",
      },
      ExpressionAttributeValues: {
        ":role": { S: role },
      },
    })
  );

  console.log(`Updated ${userId} role to ${role}`);
};