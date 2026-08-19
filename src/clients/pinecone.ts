/**
 * Pinecone client for Reply Like Me.
 * Index: reply-like-me
 * Namespaces: "messages" (text embeddings), "images" (image embeddings)
 */

import { Pinecone } from "@pinecone-database/pinecone";

export function createPineconeClient(): Pinecone {
  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing PINECONE_API_KEY in environment");
  }

  return new Pinecone({ apiKey });
}
