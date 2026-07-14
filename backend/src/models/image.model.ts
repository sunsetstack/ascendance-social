import mongoose, { Schema } from "mongoose";
import { IImage, ITag } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { generateSlug } from "@/utils/helpers";

const imageSchema = new Schema<IImage>({
	url: { type: String, required: true },
	width: { type: Number, min: 1 },
	height: { type: Number, min: 1 },
	publicId: {
		type: String,
		required: true,
		unique: true, // Defult index
		default: uuidv4,
		immutable: true,
	},
	slug: {
		type: String,
		required: true,
		index: true,
	},
	originalName: {
		type: String,
		required: true,
	},
	user: { type: Schema.Types.ObjectId, ref: "User", required: true }, // Reference to User schema
	createdAt: { type: Date, default: Date.now },
});

const tagSchema = new Schema<ITag>({
	tag: { type: String, required: true, unique: true },
	count: { type: Number, default: 0 },
	modifiedAt: { type: Date, default: Date.now },
});

// Pre-save middleware to generate slug
imageSchema.pre("save", function (next) {
	if (this.isNew && this.originalName) {
		this.slug = `${generateSlug(this.originalName) || "image"}-${Date.now()}`;
	}
	next();
});

/**This mongoose middleware allows for much easier work with data
 * on the frontend. Everything broke when I directly referenced User and Tag inside the
 * Image document because react-query was supposed to receive string as id, now it receives
 * mongoose object id.
 *
 * This function strips the `_id` and converts it to `id` of type string.
 * It transforms the nested user object that now resides inside images.
 * It removes reduntant, repetitive fields from the object(username, id)
 * and transforms nested arrays tags create.
 * Also removes __v
 *
 * The `toJSON` mongoose middleware triggers on 3 occasions:
 *   -when calling .toJSON() on a document. for example:
 *     const image = await ImageModel.findById(id);
 *     const jsonImage = image.toJSON();
 *
 *   -when sending data in a response:
 *      const image = await ImageModel.findById(id);
 *      res.json(image);
 *     - this also triggers when sending arrays as responses. if res.json(data[]),
 *        mongoose will iterate through each document and transform it
 *   -when using .lean()
 *
 */
imageSchema.set("toJSON", {
	transform: (_doc, ret: any) => {
		// Convert _id fields to id
		if (ret._id) {
			ret.id = ret._id.toString(); // Rename _id to id
			delete ret._id; // Delete the original _id
		}
		// Remove __v
		delete ret.__v;
		return ret;
	},
});

imageSchema.index({ user: 1 });

tagSchema.index({ tag: "text" });
tagSchema.index({ count: -1 });
tagSchema.index({ modifiedAt: -1 });

const Image = mongoose.model<IImage>("Image", imageSchema);
export const Tag = mongoose.model("Tag", tagSchema);
export default Image;
