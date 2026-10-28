import { expect } from "chai";
import { resolveOwnedCloudinaryAsset } from "@/utils/cloudinary-asset";

describe("Owned Cloudinary URL resolution", () => {
  const owner = "community-owner";
  const valid = "https://res.cloudinary.com/example/image/upload/v123/community-owner/asset.png";
  it("resolves only a configured cloud and the exact owner's upload folder", () => {
    expect(resolveOwnedCloudinaryAsset(valid, owner, "example")).to.equal(`${owner}/asset`);
    expect(resolveOwnedCloudinaryAsset(valid.replace("v123/", ""), owner, "example")).to.equal(`${owner}/asset`);
  });
  for (const url of [valid.replace("https:", "http:"), valid.replace("res.cloudinary.com", "res.cloudinary.com.attacker.test"),
    valid.replace("example/", "other-cloud/"), valid.replace("community-owner/", "shared/"),
    valid.replace("asset.png", "nested%2Fasset.png"), valid.replace("asset.png", "..%5Casset.png"),
    valid.replace("asset.png", "../asset.png"), `${valid}?image=other`, `https://user:password@${valid.slice(8)}`]) {
    it(`preserves unproven media: ${url}`, () => expect(resolveOwnedCloudinaryAsset(url, owner, "example")).to.equal(null));
  }
  it("requires configured ownership", () => expect(resolveOwnedCloudinaryAsset(valid, owner, undefined)).to.equal(null));
});
