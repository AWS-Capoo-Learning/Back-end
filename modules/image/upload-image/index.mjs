import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { httpError, withApi } from "api-helper";

const s3 = new S3Client({});
const bucketName = process.env.BUCKET_NAME;

const allowedContentTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);

export const handler = withApi(async (event) => {
  const userId = event.requestContext?.authorizer?.claims?.["custom:id"];
  if (!userId) {
    throw httpError(401, "Unauthorized");
  }

  if (!bucketName) {
    throw httpError(500, "Missing BUCKET_NAME");
  }

  let body;

  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    throw httpError(400, "Invalid JSON body");
  }

  const contentType = body.contentType;

  if (!contentType) {
    throw httpError(400, "Missing contentType");
  }

  if (!allowedContentTypes.has(contentType)) {
    throw httpError(
      400,
      "Only png, jpeg, and webp images are allowed"
    );
  }

  const jobId = randomUUID();
  const extension = getExtension(contentType);
  const fileName = `${jobId}.${extension}`;
  const uploadKey = `uploads/${userId}/${fileName}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: uploadKey,
    ContentType: contentType,
    Metadata: {
      userId
    }
  });

  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: 300
  });

  return {
    jobId,
    userId,
    fileName,
    uploadKey,
    uploadUrl
  };
});

function getExtension(contentType) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
}