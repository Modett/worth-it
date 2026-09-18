export interface ObjectStorageUploadInput {
  key: string;
  body: Buffer;
  mimeType: string;
}

export interface ObjectStorageUploadResult {
  url: string;
}

export interface ObjectStorageService {
  upload(input: ObjectStorageUploadInput): Promise<ObjectStorageUploadResult>;
}
