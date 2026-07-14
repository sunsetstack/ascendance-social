import { Types, Document } from "mongoose";
import { ImagePublicId, UserPublicId } from "@/types/branded";

export interface IImage extends Document {
  url: string;
  publicId: ImagePublicId;
  width?: number;
  height?: number;
  user: {
    publicId: UserPublicId;
    handle: string;
    username: string;
    avatar: string;
  };
  title?: string;
  slug: string;
  originalName: string;
  createdAt: Date;
}

export interface ImageDocWithId extends IImage {
  _id: Types.ObjectId;
  slug: string;
}

export interface PopulatedUserField {
  publicId: UserPublicId;
  handle?: string;
  username?: string;
  avatar?: string;
}
