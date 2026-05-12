import axiosClient from "./axiosClient";

// Follow/unfollow a user by their public ID
export const followUser = async (publicId: string) => {
  const response = await axiosClient.post(`/api/users/follow/${publicId}`);
  return response.data;
};

// Like/unlike a post by its public ID
export const likePost = async (postPublicId: string) => {
  const response = await axiosClient.post(
    `/api/users/like/post/${postPublicId}`,
  );
  return response.data;
};

// Legacy alias for backward compatibility
export const likeImage = likePost;
