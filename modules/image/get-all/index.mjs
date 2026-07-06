import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});
const bucketName = process.env.BUCKET_NAME;

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

  const userId =
    event.requestContext?.authorizer?.claims?.sub;

  if (!userId) {
    return response(401, {
      message: "Unauthorized"
    });
  }
  const prefix = `processed/${userId}/`;
  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 50
    })
  );
  const objects = result.Contents ?? [];
  const images = await Promise.all(
    objects
      .filter((object) =>
        object.Key &&
        object.Key !== prefix &&
        !object.Key.endsWith("/")
      )
      .map(async (object) => {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: bucketName,
            Key: object.Key
          }),
          {
            expiresIn: 3600
          }
        );

        return {
          key: object.Key,
          fileName: object.Key.split("/").pop(),
          size: object.Size,
          lastModified: object.LastModified,
          url
        };
      })
  );

  return response(200, {
    images
  });
};

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