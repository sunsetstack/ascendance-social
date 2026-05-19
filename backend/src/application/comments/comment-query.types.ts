import { TransformedComment } from "@/types";

export interface CommentListResult {
  comments: TransformedComment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CommentThreadResult {
  comment: TransformedComment | null;
  ancestors: TransformedComment[];
}
