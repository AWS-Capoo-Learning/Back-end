import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import sharp from "sharp";

const s3 = new S3Client({});
const outputBucket = process.env.BUCKET_NAME;

export const handler = async (event) => {
  console.log("Process input:", JSON.stringify(event));

  const {
    imageId,
    userId,
    sourceBucket,
    sourceKey
  } = event;

  if (!imageId || !userId || !sourceBucket || !sourceKey) {
    throw new Error(
      `Invalid process input: ${JSON.stringify(event)}`
    );
  }

  const object = await s3.send(
    new GetObjectCommand({
      Bucket: sourceBucket,
      Key: sourceKey
    })
  );

  const imageBuffer = await streamToBuffer(object.Body);

  const outputBuffer = await sharp(imageBuffer)
    .resize({
      width: 400,
      withoutEnlargement: false,
      kernel: "lanczos3"
    })
    .png({
      quality: 90,
      compressionLevel: 8
    })
    .toBuffer();

  const outputKey =
    `processed/${userId}/${imageId}-resized.png`;

  await s3.send(
    new PutObjectCommand({
      Bucket: outputBucket || sourceBucket,
      Key: outputKey,
      Body: outputBuffer,
      ContentType: "image/png",
      Metadata: {
        userId,
        sourceKey
      }
    })
  );

  console.log("Saved processed image:", outputKey);

  return {
    imageId,
    userId,
    outputKey
  };
};

async function streamToBuffer(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}