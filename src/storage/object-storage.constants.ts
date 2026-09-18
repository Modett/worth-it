/** Injection token for object storage. Tests swap a fake; production is R2. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** The S3-compatible client R2ObjectStorageService talks to. */
export const S3_CLIENT = Symbol('S3_CLIENT');
