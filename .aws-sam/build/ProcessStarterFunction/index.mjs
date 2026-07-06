import {
  SFNClient,
  StartExecutionCommand
} from "@aws-sdk/client-sfn";

const sfn = new SFNClient({});

export const handler = async (event) => {
  console.log("PROCESS_STARTER_V2");
  console.log("SQS input:", JSON.stringify(event));

  const batchItemFailures = [];

  for (const sqsRecord of event.Records ?? []) {
    try {
      const s3Event = JSON.parse(sqsRecord.body);

      for (const record of s3Event.Records ?? []) {
        if (!record.eventName?.startsWith("ObjectCreated:")) {
          console.log("Skip event:", record.eventName);
          continue;
        }

        const sourceBucket = record.s3?.bucket?.name;
        const encodedKey = record.s3?.object?.key;

        if (!sourceBucket || !encodedKey) {
          throw new Error("Missing S3 bucket or key");
        }

        const sourceKey = decodeURIComponent(
          encodedKey.replace(/\+/g, " ")
        );

        const parts = sourceKey.split("/");

        if (parts.length < 3 || parts[0] !== "uploads") {
          console.log("Skip invalid key:", sourceKey);
          continue;
        }

        const userId = parts[1];
        const fileName = parts.at(-1);
        const imageId = fileName.replace(/\.[^/.]+$/, "");
        const sequencer = record.s3.object.sequencer;

        const input = {
          imageId,
          userId,
          sourceBucket,
          sourceKey
        };

        console.log("Starting workflow:", input);

        const result = await sfn.send(
          new StartExecutionCommand({
            stateMachineArn: process.env.STATE_MACHINE_ARN,
            name: `${imageId}-${sequencer}`,
            input: JSON.stringify(input)
          })
        );

        console.log(
          "Started Step Functions:",
          result.executionArn
        );
      }
    } catch (error) {
      if (error.name === "ExecutionAlreadyExists") {
        console.log("Execution already exists");
        continue;
      }

      console.error("Failed to start workflow:", error);

      batchItemFailures.push({
        itemIdentifier: sqsRecord.messageId
      });
    }
  }

  return { batchItemFailures };
};